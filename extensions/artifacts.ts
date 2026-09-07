/**
 * Extension adapter: builds the task-manifest protocol into pi tools, commands,
 * context injection, and TUI. Thin adapters over the engine (src/engine).
 */

import type { AgentToolResult, AgentToolUpdateCallback, ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  isToolCallEventType,
  keyHint,
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { resolve, join, relative } from "node:path";
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  EngineError,
  createArtifact,
  createTask,
  findArtifact,
  readArtifact,
  loadManifest,
  setArtifactStatus,
  setBaseBranch,
  recordPhaseCommit,
  recordTaskRun,
  tryLoadManifest,
  updateArtifact,
  validateSlug,
  suggestTaskActions,
  type TaskManifest,
} from "../src/engine/index.ts";
import { resolveManagedArtifactPath } from "../src/engine/engine.ts";
import { isWithinRoot, resolveArtifactPath } from "../src/paths.ts";
import { implementPhase, reviewImplementation, startResearch, type ResearchNode, type RunProgress } from "../src/agent-runtime.ts";

export const DEFAULT_ROOT = `${CONFIG_DIR_NAME}/artifacts`;

function isResearchNode(value: string): value is ResearchNode {
  return value === "artifact-locator" || value === "artifact-analyzer" || value === "artifact-pattern-finder" || value === "artifact-web-researcher";
}

function requireResearchNodes(values: readonly string[]): ResearchNode[] {
  const nodes = values.filter(isResearchNode);
  if (nodes.length !== values.length) throw new Error("nodes contains an unsupported research agent.");
  return nodes;
}

function defaultWorkspaceConfig() {
  return {
    disabled: false,
    pathTemplate: `~/${CONFIG_DIR_NAME}/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}`,
    branchTemplate: "{{ TASKSLUG }}",
    repos: [{
      localPath: ".",
      primary: true,
      sourceRef: "origin/main",
      setupCommand: "",
      copyGlobs: [".env*", `${CONFIG_DIR_NAME}/settings.json`, `${CONFIG_DIR_NAME}/workspace.local.json`],
    }],
  };
}

/** Add missing gitignore entries without changing existing entries. */
async function ensureGitignoreEntries(cwd: string, entries: string[]): Promise<void> {
  const path = resolve(cwd, ".gitignore");
  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !((error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
    existing = "";
  }
  const present = new Set(existing.split(/\r?\n/));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  await writeFile(path, `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`, "utf8");
}

/** Create the shared workspace configuration once, preserving local customizations. */
async function ensureWorkspaceConfig(cwd: string): Promise<void> {
  const path = resolve(cwd, CONFIG_DIR_NAME, "workspace.json");
  try {
    await writeFile(path, `${JSON.stringify(defaultWorkspaceConfig(), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !((error as NodeJS.ErrnoException).code === "EEXIST")) throw error;
  }
}
const execFileAsync = promisify(execFile);

type PlannotatorAnnotationDecision = "approved" | "dismissed" | "annotated";

type PlannotatorAnnotationOutcome = {
  decision: PlannotatorAnnotationDecision;
  feedback: string;
};

/** Parse the JSON decision returned by `plannotator annotate --json`. */
function parsePlannotatorAnnotationOutcome(output: string): PlannotatorAnnotationOutcome | null {
  try {
    const result: unknown = JSON.parse(output);
    if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
    const decision = "decision" in result ? result.decision : undefined;
    const feedback = "feedback" in result ? result.feedback : undefined;
    if ((decision !== "approved" && decision !== "dismissed" && decision !== "annotated") || typeof feedback !== "string") return null;
    return { decision, feedback: feedback.trim() };
  } catch {
    return null;
  }
}

/** Build the RPI follow-up message from human artifact annotations. */
function plannotatorFeedbackPrompt(taskDirectory: string, feedback: string): string {
  return `# RPI Artifact Annotations\n\nArtifact directory: ${taskDirectory}\n\n${feedback}\n\nAddress this feedback using RPI tools. Use the matching iterate-* skill when the feedback concerns an existing iteratable artifact. Do not guess artifact file paths; inspect the active task first.`;
}
const TASK_SELECTION_ENTRY = "rpi-active-task-selection";
const TASK_STATUS_ENTRY = "rpi-task-status";
const selectedTasks = new WeakMap<ExtensionAPI, { slug: string; taskDir: string }>();
const unavailableTaskSlugs = new WeakMap<ExtensionAPI, Set<string>>();

type TaskSelectionEntry = { slug: string };
type TaskStatusEntry = { report: string };

/** Root of all task artifacts for a project. */
function artifactRoot(cwd: string): string {
  return resolve(cwd, DEFAULT_ROOT);
}

function artifactManifestPath(taskDirectory: string): string {
  return join(taskDirectory, "artifact-manifest.json");
}

function withTaskMutationQueue<T>(taskDirectory: string, operation: () => Promise<T>): Promise<T> {
  return withFileMutationQueue(artifactManifestPath(taskDirectory), operation);
}

function parseTaskSelectionEntry(data: unknown): TaskSelectionEntry | null {
  if (data === null || typeof data !== "object" || Array.isArray(data) || !("slug" in data) || typeof data.slug !== "string") return null;
  try {
    validateSlug(data.slug);
    return { slug: data.slug };
  } catch {
    return null;
  }
}

function parseTaskStatusEntry(data: unknown): TaskStatusEntry | null {
  if (data === null || typeof data !== "object" || Array.isArray(data) || !("report" in data) || typeof data.report !== "string") return null;
  return { report: data.report };
}

/** Update Pi's built-in footer with concise non-binding task suggestions. */
function setActiveTaskFooter(ctx: ExtensionContext, manifest: TaskManifest): void {
  if (!ctx.hasUI) return;
  const inReview = manifest.artifacts.filter((artifact) => artifact.status === "in-review").length;
  const actions = suggestTaskActions(manifest).slice(0, 2).map((action) => action.label).join(", ") || "none";
  ctx.ui.setStatus("rpi-active", `${manifest.slug} · ${manifest.flow} · actions: ${actions} · ${inReview} in review`);
}

function clearActiveTaskFooter(ctx: ExtensionContext): void {
  if (ctx.hasUI) ctx.ui.setStatus("rpi-active", undefined);
}

function taskDir(root: string, slug: string): string {
  validateSlug(slug);
  return resolve(root, slug);
}

async function currentTask(pi: ExtensionAPI, ctx: ExtensionContext): Promise<{ slug: string; taskDir: string } | null> {
  const selected = selectedTasks.get(pi);
  if (selected) return isTaskUnavailable(pi, selected.slug) ? null : selected;
  // Scan in reverse so the latest persisted or legacy selection wins.
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "custom" && entry.customType === TASK_SELECTION_ENTRY) {
      const persisted = parseTaskSelectionEntry(entry.data);
      if (!persisted) continue;
      if (isTaskUnavailable(pi, persisted.slug)) return null;
      const restored = { slug: persisted.slug, taskDir: taskDir(artifactRoot(ctx.cwd), persisted.slug) };
      selectedTasks.set(pi, restored);
      return restored;
    }
    if (entry?.type !== "message") continue;
    if (entry.message.role !== "toolResult") continue;
    if (entry.message.toolName !== "rpi_create_task" && entry.message.toolName !== "rpi_get_task_context") continue;
    const details = entry.message.details as { taskSlug?: string } | undefined;
    if (details?.taskSlug) {
      try {
        validateSlug(details.taskSlug);
      } catch {
        continue;
      }
      if (isTaskUnavailable(pi, details.taskSlug)) return null;
      const restored = { slug: details.taskSlug, taskDir: taskDir(artifactRoot(ctx.cwd), details.taskSlug) };
      selectedTasks.set(pi, restored);
      return restored;
    }
  }
  return null;
}

function selectTask(pi: ExtensionAPI, cwd: string, slug: string): void {
  unavailableTaskSlugs.get(pi)?.delete(slug);
  selectedTasks.set(pi, { slug, taskDir: taskDir(artifactRoot(cwd), slug) });
  pi.appendEntry<TaskSelectionEntry>(TASK_SELECTION_ENTRY, { slug });
}

function isTaskUnavailable(pi: ExtensionAPI, slug: string): boolean {
  return unavailableTaskSlugs.get(pi)?.has(slug) ?? false;
}

function markTaskUnavailable(pi: ExtensionAPI, slug: string): void {
  selectedTasks.delete(pi);
  const slugs = unavailableTaskSlugs.get(pi) ?? new Set<string>();
  slugs.add(slug);
  unavailableTaskSlugs.set(pi, slugs);
}

type BoundedToolOutput = { text: string; truncated: boolean; fullOutputPath?: string };

async function boundedToolText(text: string, fullOutputPath?: string): Promise<BoundedToolOutput> {
  const truncation = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return { text: truncation.content, truncated: false };
  const preservedOutputPath = fullOutputPath ?? await persistFullToolOutput(text);
  return {
    text: `${truncation.content}\n\n[Output truncated: lines ${truncation.outputLines} of ${truncation.totalLines}; bytes ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}; ${truncation.truncatedBy} limit. Full output: ${preservedOutputPath}]`,
    truncated: true,
    fullOutputPath: preservedOutputPath,
  };
}

async function persistFullToolOutput(text: string): Promise<string> {
  const outputDirectory = await mkdtemp(join(tmpdir(), "rpi-tool-output-"));
  const outputPath = join(outputDirectory, "output.txt");
  await withFileMutationQueue(outputPath, () => writeFile(outputPath, text, "utf8"));
  return outputPath;
}


function requireCommandUI(ctx: ExtensionCommandContext): void {
  if (!ctx.hasUI) throw new Error("RPI commands require interactive or RPC mode; print and JSON modes are unsupported.");
}

function taskStatusReport(manifest: TaskManifest): string {
  const lines = [`# ${manifest.slug} (${manifest.flow})`, "", "Artifacts:"];
  if (manifest.artifacts.length === 0) lines.push("- (none yet)");
  for (const artifact of manifest.artifacts) {
    lines.push(`- [${artifact.status}] ${artifact.id}: ${artifact.path}`);
  }
  const edges = manifest.artifacts.flatMap((artifact) => artifact.dependsOn.map((dependency) => `${dependency} → ${artifact.id}`));
  lines.push("", "Dependencies:", ...(edges.length > 0 ? edges.map((edge) => `- ${edge}`) : ["- (none)"]));
  lines.push("", "Suggested actions:", ...suggestTaskActions(manifest).map((action) => `- ${action.label}`));
  return lines.join("\n");
}

function collapsedTaskStatusReport(report: string): string {
  const lines = report.split("\n");
  const actionHeading = lines.indexOf("Suggested actions:");
  const firstAction = actionHeading === -1 ? undefined : lines.slice(actionHeading + 1).find((line) => line.startsWith("- "));
  const summary = firstAction ? `${lines[0]}\nNext: ${firstAction.slice(2)}` : lines[0];
  return `${summary} (${keyHint("app.tools.expand", "to expand")})`;
}

async function publishTaskStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext, manifest: TaskManifest): Promise<void> {
  const report = taskStatusReport(manifest);
  if (ctx.mode === "rpc") {
    await ctx.ui.notify(report, "info");
    return;
  }
  pi.appendEntry<TaskStatusEntry>(TASK_STATUS_ENTRY, { report });
}

function runPayloadText(payload: unknown): string {
  if (payload !== null && typeof payload === "object" && "text" in payload && typeof payload.text === "string") return payload.text;
  return JSON.stringify(payload);
}

function implementationRunText(phaseId: string, runId: string, state: string, payload: unknown): string {
  const outcome = state === "complete"
    ? `Implementation phase ${phaseId} completed successfully (run ${runId}).`
    : state === "partial"
      ? `Implementation phase ${phaseId} completed partially (run ${runId}).`
      : `Implementation phase ${phaseId} failed with state "${state}" (run ${runId}).`;
  return `${outcome}\n\n${JSON.stringify(payload)}`;
}

/** Trusted context used to build one implementation child's complete phase assignment. */
interface ImplementationPhaseTaskInput {
  taskSlug: string;
  taskDir: string;
  sourceArtifactType: "ticket" | "plan" | "structure-outline";
  sourceArtifactPath: string;
  phaseId: string;
  instruction: string;
}

/** Build the code-only implementation prompt from validated task state. */
function buildImplementationPhaseTask(input: ImplementationPhaseTaskInput): string {
  return [
    "# RPI implementation phase assignment",
    "",
    "The parent extension has already selected and validated this phase. Do not rediscover the task from session history, artifact stores, temp directories, or missions.",
    `Selected task slug: ${input.taskSlug}`,
    `Task directory: ${input.taskDir}`,
    `Authoritative artifact type: ${input.sourceArtifactType}`,
    `Authoritative artifact path: ${input.sourceArtifactPath}`,
    `Exact phase ID: ${input.phaseId}`,
    "",
    "Caller instruction (supplement only; the authoritative artifact and phase ID above control scope):",
    input.instruction,
    "",
    "Ownership and boundaries:",
    "- Implement the requested code and tests in the repository checkout.",
    "- Read the authoritative artifact at the exact path above, then only the source files and dependencies required by this phase.",
    "- This is code-only work. Do not create, update, approve, supersede, or otherwise mutate RPI task artifacts.",
    "- Do not wait for a human gate, mark the phase complete, commit, or record a phase receipt. The parent owns those actions.",
    "- Use contact_supervisor only for a real plan/code conflict that cannot be resolved from the authoritative artifact.",
    "",
    "Required final evidence:",
    "- changed files",
    "- exact focused automated commands and their results",
    "- residual risks or omitted checks",
    "- manual checks the parent must perform",
    "End with: ready for parent verification.",
  ].join("\n");
}

function resolveImplementationPhase(sourceType: "ticket" | "plan" | "structure-outline", source: string, requestedPhaseId: string): string {
  if (sourceType === "ticket") {
    if (requestedPhaseId.trim() !== "implementation") throw new Error('Oneshot ticket implementation must use phase ID "implementation".');
    return "implementation";
  }
  const headings = [...source.matchAll(/^##\s+(?:✅\s+)?(Phase\s+\d+(?::[^\r\n]*)?)\s*$/gim)].map((match) => match[1]!.trim());
  const requested = requestedPhaseId.trim();
  const matches = headings.filter((heading) => heading === requested);
  if (matches.length !== 1) throw new Error(`Implementation phase "${requestedPhaseId}" must match exactly one phase heading in the authoritative artifact.`);
  return matches[0]!;
}

type AgentRunOperation = "research" | "implementation" | "review";
type AgentRunProgressDetails = {
  operation: AgentRunOperation;
  runId: string;
  state: string;
  pollCount: number;
  phaseId?: string;
  currentTool?: string;
  turnCount?: number;
  toolCount?: number;
};

function emitAgentRunProgress(
  onUpdate: AgentToolUpdateCallback<AgentRunProgressDetails> | undefined,
  operation: AgentRunOperation,
  progress: RunProgress,
  phaseId?: string,
): void {
  const phase = phaseId ? ` phase ${phaseId}` : "";
  const activity = progress.activity;
  const activityParts = [
    activity?.currentTool,
    activity?.turnCount === undefined ? undefined : `${activity.turnCount} turns`,
    activity?.toolCount === undefined ? undefined : `${activity.toolCount} tools`,
  ].filter((part): part is string => part !== undefined);
  const activityText = activityParts.length > 0 ? ` · ${activityParts.join(" · ")}` : ` (poll ${progress.pollCount})`;
  onUpdate?.({
    content: [{ type: "text", text: `${operation}${phase} run ${progress.runId}: ${progress.state}${activityText}.` }],
    details: {
      operation,
      runId: progress.runId,
      state: progress.state,
      pollCount: progress.pollCount,
      ...(phaseId ? { phaseId } : {}),
      ...(activity?.currentTool !== undefined ? { currentTool: activity.currentTool } : {}),
      ...(activity?.turnCount !== undefined ? { turnCount: activity.turnCount } : {}),
      ...(activity?.toolCount !== undefined ? { toolCount: activity.toolCount } : {}),
    },
  });
}

function renderAgentRunResult(
  operation: AgentRunOperation,
  result: AgentToolResult<unknown>,
  { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  context: { isError: boolean },
): Text {
  const details = result.details as { runId?: unknown; state?: unknown; phaseId?: unknown; currentTool?: unknown; turnCount?: unknown; toolCount?: unknown } | undefined;
  const text = result.content.find((block) => block.type === "text")?.text ?? "Agent run failed without an error message.";
  const runId = typeof details?.runId === "string" ? details.runId : "unknown";
  const state = typeof details?.state === "string" ? details.state : "running";
  const phase = typeof details?.phaseId === "string" ? ` phase ${details.phaseId}` : "";
  const label = `${operation}${phase} run ${runId}`;
  if (state === "partial") {
    const outcome = theme.fg("warning", `${label}: completed partially`);
    if (!expanded) return new Text(outcome, 0, 0);
    return new Text(`${outcome}\n${text}`, 0, 0);
  }
  if (context.isError) return new Text(theme.fg("error", `${operation} failed: ${text}`), 0, 0);
  if (isPartial) {
    const activityParts = [
      typeof details?.currentTool === "string" ? details.currentTool : undefined,
      typeof details?.turnCount === "number" ? `${details.turnCount} turns` : undefined,
      typeof details?.toolCount === "number" ? `${details.toolCount} tools` : undefined,
    ].filter((part): part is string => part !== undefined);
    const activityText = activityParts.length > 0 ? ` · ${activityParts.join(" · ")}` : "";
    return new Text(theme.fg("warning", `${label}: ${state}${activityText}`), 0, 0);
  }
  const outcome = state === "complete" ? theme.fg("success", `${label}: complete`) : theme.fg("error", `${label}: ${state}`);
  if (!expanded) return new Text(outcome, 0, 0);
  return new Text(`${outcome}\n${text}`, 0, 0);
}
/** Fail-closed shell-token policy for staging commands that could include local artifacts. */
export function gitAddBlockReason(command: string, cwd: string): string | null {
  const trimmed = command.trim();
  if (/\b(?:sh|bash)\s+-c\b[\s\S]*\bgit\s+add\b/.test(trimmed)) return "Refusing ambiguous git add; stage literal explicit safe source paths only.";
  const mentionsAdd = /\badd\b/.test(trimmed);
  const mentionsGit = /(?:^|[\s;&|])(?:git|\/usr\/bin\/git|["']git["']|["']\/usr\/bin\/git["'])\b/.test(trimmed) || /(?:\$\{?\w+\}?|["']\$\{?\w+\}?["'])\s+add\b/.test(trimmed);
  if (!mentionsAdd || !mentionsGit) return null;
  const match = trimmed.match(/^(?:git|\/usr\/bin\/git|["']git["']|["']\/usr\/bin\/git["'])\s+(?:-C\s+([^\s]+)\s+)?add\s+(?:--\s+)?(.+)$/);
  if (!match || /[;&|`$]/.test(trimmed)) return "Refusing ambiguous git add; stage literal explicit safe source paths only.";
  const gitCwd = resolve(cwd, (match[1] ?? ".").replace(/^['"]|['"]$/g, ""));
  const paths = (match[2] ?? "").match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? [];
  if (paths.length === 0) return "Refusing ambiguous or broad git add; stage explicit safe source paths only.";
  for (const raw of paths) {
    const path = raw.replace(/^['"]|['"]$/g, "");
    if (path === "." || path === ":/" || path.startsWith(":") || path.startsWith("-") || /[*?\[\]{}]/.test(path)) return "Refusing ambiguous or broad git add; stage explicit safe source paths only.";
    if (isWithinRoot(resolve(cwd, DEFAULT_ROOT), resolveArtifactPath(gitCwd, path))) return `Refusing to stage the artifact root (${DEFAULT_ROOT}).`;
  }
  return null;
}

export default function artifactsExtension(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<TaskStatusEntry>(TASK_STATUS_ENTRY, (entry, { expanded }) => {
    const status = parseTaskStatusEntry(entry.data);
    const report = status?.report ?? "RPI task status is unavailable.";
    return new Text(expanded ? report : collapsedTaskStatusReport(report), 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    clearActiveTaskFooter(ctx);
    const active = await currentTask(pi, ctx);
    if (!active) return;
    const manifest = await tryLoadManifest(active.taskDir);
    if (!manifest) {
      markTaskUnavailable(pi, active.slug);
      return;
    }
    setActiveTaskFooter(ctx, manifest);
  });

  pi.on("session_tree", async (_event, ctx) => {
    selectedTasks.delete(pi);
    clearActiveTaskFooter(ctx);
    const active = await currentTask(pi, ctx);
    if (!active) return;
    const manifest = await tryLoadManifest(active.taskDir);
    if (!manifest) {
      markTaskUnavailable(pi, active.slug);
      return;
    }
    setActiveTaskFooter(ctx, manifest);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const active = await currentTask(pi, ctx);
    if (!active) return;
    const manifest = await tryLoadManifest(active.taskDir);
    if (!manifest) {
      markTaskUnavailable(pi, active.slug);
      if (ctx.hasUI) await ctx.ui.notify(`Selected task "${active.slug}" is unavailable. Select another task with /rpi-task.`, "warning");
      return;
    }
    setActiveTaskFooter(ctx, manifest);
    return {
      systemPrompt: `${event.systemPrompt}\n\nActive task: ${active.slug}. Task artifacts live in ${DEFAULT_ROOT}/${active.slug}. Use rpi_* tools to inspect or mutate task artifacts.`,
    };
  });

  // ---------------------------------------------------------------
  // Tool: select the active task (persisted via tool details)
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_create_task",
    label: "RPI Create Task",
    description:
      "Create a new task with the given slug, title, flow, and optional ticket body. Idempotent (returns existing task if present). Sets it as the active task.",
    promptSnippet: "rpi_create_task — create a task and select it",
    promptGuidelines: [
      "Use rpi_create_task with the desired flow (rpi, prd, oneshot, freeform) before creating artifacts.",
    ],
    parameters: Type.Object({
      slug: Type.String({ description: "Task slug, kebab-case" }),
      title: Type.String({ description: "Human-readable task title" }),
      flow: StringEnum(["rpi", "prd", "oneshot", "freeform"] as const),
      baseBranch: Type.Optional(Type.String({ description: "Base branch (default main)" })),
      ticketBody: Type.Optional(Type.String({ description: "Optional initial ticket markdown body" })),
      ticketUrl: Type.Optional(Type.String({ description: "Optional ticket URL stored in the manifest" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const taskDirectory = taskDir(root, params.slug);
      const manifest = await withTaskMutationQueue(taskDirectory, () => createTask(root, {
        slug: params.slug,
        title: params.title,
        flow: params.flow,
        baseBranch: params.baseBranch ?? "main",
        ticketBody: params.ticketBody,
        ticketUrl: params.ticketUrl,
      }));
      selectTask(pi, ctx.cwd, params.slug);
      setActiveTaskFooter(ctx, manifest);
      return {
        content: [{ type: "text", text: `Task created/selected: ${params.slug} (${manifest.flow})` }],
        details: { taskSlug: params.slug, flow: manifest.flow },
      };
    },
  });

  // ---------------------------------------------------------------
  // Tool: select the active task (persisted via tool details)
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_get_task_context",
    label: "RPI Get Task Context",
    description:
      "Select the active task by slug and return its manifest summary. Persists selection in tool details for restoration.",
    promptSnippet: "rpi_get_task_context — select/read active task",
    promptGuidelines: ["Use rpi_get_task_context before other rpi_* tools so the active task is selected."],
    parameters: Type.Object({
      slug: Type.String({ description: "Task slug, e.g. eng-1478-parent-child-tracking" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const dir = taskDir(root, params.slug);
      let manifest;
      try {
        manifest = await loadManifest(dir);
      } catch (err) {
        throw new Error(`Task "${params.slug}" not found or malformed: ${String(err)}`);
      }
      setActiveTaskFooter(ctx, manifest);
      selectTask(pi, ctx.cwd, params.slug);
      const summary = {
        slug: manifest.slug,
        title: manifest.title,
        flow: manifest.flow,
        baseBranch: manifest.baseBranch,
        artifacts: manifest.artifacts.map((a) => ({ id: a.id, type: a.type, status: a.status })),
        suggestedActions: suggestTaskActions(manifest).map((action) => action.label),
      };
      return {
        content: [{ type: "text", text: `Active task: ${params.slug}\n${JSON.stringify(summary, null, 2)}` }],
        details: { taskSlug: params.slug },
      };
    },
  });

  // ---------------------------------------------------------------
  // Tool: list artifacts
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_list_artifacts",
    label: "RPI List Artifacts",
    description: "List the artifacts in the active task with their statuses.",
    promptSnippet: "rpi_list_artifacts — list artifacts in the active task",
    parameters: Type.Object({
      slug: Type.Optional(Type.String({ description: "Task slug (defaults to the selected task)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const active = await currentTask(pi, ctx);
      const slug = params.slug ?? active?.slug;
      if (!slug) throw new Error("No task selected. First call rpi_get_task_context.");
      const manifest = await loadManifest(taskDir(root, slug));
      const lines = ["Artifacts:"];
      for (const a of manifest.artifacts) {
        lines.push(`[${a.status}] ${a.path} (${a.type}, depends: ${a.dependsOn.join(",") || "none"})`);
      }
      const output = await boundedToolText(lines.join("\n"));
      return { content: [{ type: "text", text: output.text }], details: output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {} };
    },
  });

  // ---------------------------------------------------------------
  // Tool: read an artifact file
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_read_artifact",
    label: "RPI Read Artifact",
    description: "Read the file content of an artifact in the active task.",
    promptSnippet: "rpi_read_artifact — read an artifact file",
    parameters: Type.Object({
      artifactId: Type.String({ description: "Artifact id (type), e.g. research" }),
      slug: Type.Optional(Type.String({ description: "Task slug (defaults to selected task)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const active = await currentTask(pi, ctx);
      const slug = params.slug ?? active?.slug;
      if (!slug) throw new Error("No task selected. First call rpi_get_task_context.");
      const manifest = await loadManifest(taskDir(root, slug));
      const artifactInfo = findArtifact(manifest, params.artifactId);
      if (!artifactInfo) throw new Error(`Artifact "${params.artifactId}" not found.`);
      const directory = taskDir(root, slug);
      const content = await readArtifact(directory, artifactInfo.id);
      const output = await boundedToolText(content, join(directory, artifactInfo.path));
      return { content: [{ type: "text", text: output.text }], details: { artifactId: params.artifactId, path: join(directory, artifactInfo.path) } };
    },
  });

  // ---------------------------------------------------------------
  // Tool: create an artifact (validates flow/deps, assigns NN name, writes manifest)
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_create_artifact",
    label: "RPI Create Artifact",
    description:
      "Create a new artifact document in the active task. Validates the type against the task flow and dependencies, assigns the next chronological NN- filename, writes the file and updates the manifest atomically.",
    promptSnippet: "rpi_create_artifact — create an artifact document",
    promptGuidelines: [
      "Use rpi_create_artifact to create all task documents (research, design, outline, plan, etc.) instead of the built-in write tool.",
    ],
    parameters: Type.Object({
      type: StringEnum([
        "research-questions",
        "research",
        "design-discussion",
        "prd",
        "tdd",
        "structure-outline",
        "plan",
        "mockup",
        "diagram",
        "implementation",
        "pr-walkthrough",
        "pr-description",
      ] as const),
      description: Type.String({ description: "2-4 word kebab slug for the filename, e.g. parent-child-tracking" }),
      content: Type.String({ description: "Full markdown content of the document" }),
      dependsOn: Type.Array(Type.String(), { description: "Artifact ids this depends on" }),
      status: Type.Optional(StringEnum(["draft", "in-review", "approved"] as const)),
      supersedes: Type.Optional(Type.String({ description: "Id or logical type of the artifact this replaces (must be approved)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const created = await withTaskMutationQueue(active.taskDir, () => createArtifact(active.taskDir, {
        type: params.type,
        description: params.description,
        content: params.content,
        dependsOn: params.dependsOn,
        status: params.status,
        supersedes: params.supersedes,
      }));
      const artifact = findArtifact(created.manifest, params.type);
      if (!artifact) throw new Error(`Artifact "${params.type}" was not created.`);
      setActiveTaskFooter(ctx, created.manifest);
      return {
        content: [
          {
            type: "text" as const,
            text: `Created ${params.type} at ${artifact.path} in task ${active.slug}.`,
          },
        ],
        details: { artifactId: artifact.id, path: artifact.path },
      };
    },
  });

  // ---------------------------------------------------------------
  // Tool: update an artifact in place (rehash + persist)
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_update_artifact",
    label: "RPI Update Artifact",
    description:
      "Update an existing artifact document's content in place, recomputing its content hash and persisting the manifest.",
    promptSnippet: "rpi_update_artifact — update an artifact document in place",
    parameters: Type.Object({
      artifactId: Type.String({ description: "Artifact id (type) to update" }),
      content: Type.String({ description: "New full markdown content" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const { contentHash, updatedManifest } = await withTaskMutationQueue(active.taskDir, async () => {
        const manifest = await loadManifest(active.taskDir);
        const artifactInfo = findArtifact(manifest, params.artifactId);
        if (!artifactInfo) throw new Error(`Artifact "${params.artifactId}" not found.`);
        const result = await updateArtifact(active.taskDir, params.artifactId, params.content);
        return { contentHash: result.artifact.contentHash, updatedManifest: await loadManifest(active.taskDir) };
      });
      setActiveTaskFooter(ctx, updatedManifest);
      return {
        content: [{ type: "text", text: `Updated ${params.artifactId}.` }],
        details: { artifactId: params.artifactId, contentHash },
      };
    },
  });

  // ---------------------------------------------------------------
  // Tool: set artifact status (approve, etc.)
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_set_artifact_status",
    label: "RPI Set Artifact Status",
    description:
      "Set an artifact's status (draft, in-review, approved, superseded) with transition validation.",
    promptSnippet: "rpi_set_artifact_status — set artifact status",
    parameters: Type.Object({
      artifactId: Type.String({ description: "Artifact id (type)" }),
      status: StringEnum(["draft", "in-review", "approved", "superseded"] as const),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const manifest = await loadManifest(active.taskDir);
      await withTaskMutationQueue(active.taskDir, () => setArtifactStatus(manifest, params.artifactId, params.status, active.taskDir));
      setActiveTaskFooter(ctx, await loadManifest(active.taskDir));
      return {
        content: [{ type: "text", text: `${params.artifactId} -> ${params.status}` }],
        details: { artifactId: params.artifactId, status: params.status },
      };
    },
  });

  // Agent-launch tools: real pi-subagents adapters (M4)
  // ---------------------------------------------------------------
  pi.registerTool({
    name: "rpi_start_research",
    label: "RPI Start Research",
    description:
      "Launch the research fanout (2-6 parallel fresh read-only research children) for the active task and return the run receipt with node types and tasks. The parent synthesizes results into the research artifact.",
    promptSnippet: "rpi_start_research — launch research fanout",
    promptGuidelines: [
      "Use rpi_start_research to run the research fanout; provide 2-6 node types and matching task strings, then synthesize results into the research artifact.",
    ],
    parameters: Type.Object({
      nodes: Type.Array(
        StringEnum(["artifact-locator", "artifact-analyzer", "artifact-pattern-finder", "artifact-web-researcher"] as const),
        { description: "2-6 research node types" },
      ),
      tasks: Type.Array(Type.String(), { description: "One task string per node, same length" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const nodes = requireResearchNodes(params.nodes);
      const receipt = await startResearch(pi, nodes, params.tasks, ctx.cwd, { signal, onSpawn: async (runId) => {
        await withTaskMutationQueue(active.taskDir, () => recordTaskRun(active.taskDir, runId, "research fanout"));
      }, onProgress: (progress) => emitAgentRunProgress(onUpdate, "research", progress) });
      const output = await boundedToolText(`Research fanout run ${receipt.runId} ${receipt.state} across ${params.nodes.length} nodes.\n\n${runPayloadText(receipt.payload)}`);
      return {
        content: [{ type: "text" as const, text: output.text }],
        details: { runId: receipt.runId, state: receipt.state, nodes: params.nodes, ...(output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {}) },
      };
    },
    renderResult(result, options, theme, context) {
      return renderAgentRunResult("research", result, options, theme, context);
    },
  });

  pi.registerTool({
    name: "rpi_implement_phase",
    label: "RPI Implement Phase",
    description:
      "Launch a single implementer agent for exactly one canonical phase of the active task. Plan/outline phases use the exact heading; oneshot ticket phases use implementation. The parent verifies automated checks afterwards and gates on the human.",
    promptSnippet: "rpi_implement_phase — run one implementation phase",
    promptGuidelines: [
      "Use rpi_implement_phase for exactly one phase at a time with a single writer; run automated checks after and present the manual-verification gate.",
    ],
    parameters: Type.Object({
      phaseId: Type.String({ maxLength: 200, description: "Exact Phase N: title heading text without leading ## or a completion marker, or implementation for an approved oneshot ticket" }),
      agent: StringEnum(["artifact-implementer", "artifact-outline-implementer"] as const),
      phaseTask: Type.String({ maxLength: 4_000, description: "Task text describing the phase to implement" }),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum implementation phase duration in milliseconds (default 900000)" })),
      model: Type.Optional(Type.String({ maxLength: 200, description: "Optional implementation child model override" })),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const manifest = await loadManifest(active.taskDir);
      const sourceArtifactType: ImplementationPhaseTaskInput["sourceArtifactType"] = params.agent === "artifact-implementer"
        ? manifest.flow === "oneshot" ? "ticket" : "plan"
        : "structure-outline";
      const sourceArtifact = findArtifact(manifest, sourceArtifactType);
      if (!sourceArtifact || sourceArtifact.status === "superseded") {
        throw new Error(`Implementation phase requires an active ${sourceArtifactType} artifact.`);
      }
      if (sourceArtifact.status !== "approved") {
        throw new Error(`Implementation phase requires an approved ${sourceArtifactType} artifact; current status is "${sourceArtifact.status}".`);
      }
      const sourceArtifactPath = await resolveManagedArtifactPath(active.taskDir, sourceArtifact.path);
      const sourceContent = await readFile(sourceArtifactPath, "utf8");
      const canonicalPhaseId = resolveImplementationPhase(sourceArtifactType, sourceContent, params.phaseId);
      const implementationTask = buildImplementationPhaseTask({
        taskSlug: manifest.slug,
        taskDir: active.taskDir,
        sourceArtifactType,
        sourceArtifactPath,
        phaseId: canonicalPhaseId,
        instruction: params.phaseTask,
      });
      const receipt = await implementPhase(pi, params.agent, implementationTask, ctx.cwd, { signal, runTimeoutMs: params.timeoutMs, model: params.model, phaseId: canonicalPhaseId, onSpawn: async (runId) => {
        await withTaskMutationQueue(active.taskDir, () => recordTaskRun(active.taskDir, runId, `implementation phase ${canonicalPhaseId}`));
      }, onProgress: (progress) => emitAgentRunProgress(onUpdate, "implementation", progress, canonicalPhaseId) });
      const output = await boundedToolText(implementationRunText(canonicalPhaseId, receipt.runId, receipt.state, receipt.payload));
      return {
        content: [{ type: "text" as const, text: output.text }],
        details: { runId: receipt.runId, state: receipt.state, phaseId: canonicalPhaseId, ...(output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {}) },
      };
    },
    renderResult(result, options, theme, context) {
      return renderAgentRunResult("implementation", result, options, theme, context);
    },
  });

  pi.registerTool({
    name: "rpi_review_implementation",
    label: "RPI Review Implementation",
    description:
      "Launch a fresh read-only reviewer to compare the plan against base...HEAD and return the deviation report run.",
    promptSnippet: "rpi_review_implementation — plan-vs-implementation review",
    promptGuidelines: [
      "Use rpi_review_implementation before writing a PR description; the reviewer reports deviations, additions, and unimplemented items.",
    ],
    parameters: Type.Object({
      reviewTask: Type.String({ description: "Instructions naming the plan artifact and base branch" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const receipt = await reviewImplementation(pi, params.reviewTask, ctx.cwd, { signal, onSpawn: async (runId) => {
        await withTaskMutationQueue(active.taskDir, () => recordTaskRun(active.taskDir, runId, "implementation review"));
      }, onProgress: (progress) => emitAgentRunProgress(onUpdate, "review", progress) });
      const output = await boundedToolText(`Implementation review run ${receipt.runId} ${receipt.state}.\n\n${runPayloadText(receipt.payload)}`);
      return {
        content: [{ type: "text" as const, text: output.text }],
        details: { runId: receipt.runId, state: receipt.state, ...(output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {}) },
      };
    },
    renderResult(result, options, theme, context) {
      return renderAgentRunResult("review", result, options, theme, context);
    },
  });

  pi.registerTool({
    name: "rpi_record_phase_commit",
    label: "RPI Record Phase Commit",
    description: "Record a verified Git commit for a completed implementation phase.",
    promptSnippet: "rpi_record_phase_commit — record a verified implementation phase commit",
    parameters: Type.Object({ phaseId: Type.String(), runId: Type.String(), commitSha: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      if (!/^[0-9a-f]{7,64}$/i.test(params.commitSha)) throw new Error("commitSha must be a Git object ID.");
      let commitSha: string;
      try { ({ stdout: commitSha } = await execFileAsync("git", ["rev-parse", "--verify", `${params.commitSha}^{commit}`], { cwd: ctx.cwd })); }
      catch { throw new Error(`Commit ${params.commitSha} does not exist in this repository.`); }
      const canonicalCommitSha = commitSha.trim();
      await withTaskMutationQueue(active.taskDir, () => recordPhaseCommit(active.taskDir, params.phaseId, params.runId, canonicalCommitSha));
      return { content: [{ type: "text", text: `Recorded commit ${canonicalCommitSha} for phase ${params.phaseId}.` }], details: { ...params, commitSha: canonicalCommitSha } };
    },
  });

  pi.registerTool({
    name: "rpi_git_diff",
    label: "RPI Git Diff",
    description: "Read a bounded diff from an existing base ref to HEAD for implementation review.",
    promptSnippet: "rpi_git_diff — read a bounded base-to-HEAD implementation diff",
    parameters: Type.Object({ baseRef: Type.String({ description: "Existing Git base ref" }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!/^[A-Za-z0-9._/@-]+$/.test(params.baseRef)) throw new Error("baseRef contains unsupported characters.");
      try { await execFileAsync("git", ["rev-parse", "--verify", `${params.baseRef}^{commit}`], { cwd: ctx.cwd }); }
      catch { throw new Error(`Base ref ${params.baseRef} does not exist.`); }
      const outputDir = await mkdtemp(join(tmpdir(), "rpi-git-diff-"));
      const outputPath = join(outputDir, "diff.txt");
      let preserveOutput = false;
      try {
        await execFileAsync("git", ["diff", "--no-ext-diff", "--unified=3", `--output=${outputPath}`, `${params.baseRef}...HEAD`], { cwd: ctx.cwd });
        const output = await boundedToolText(await readFile(outputPath, "utf8"), outputPath);
        preserveOutput = output.truncated;
        return {
          content: [{ type: "text", text: output.text }],
          details: { baseRef: params.baseRef, ...(output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {}) },
        };
      } finally {
        if (!preserveOutput) await rm(outputDir, { recursive: true, force: true });
      }
    },
  });

  // Commands
  // ---------------------------------------------------------------
  pi.registerCommand("rpi-init", {
    description: "Initialize artifacts and the default shared worktree configuration. Idempotent.",
    handler: async (_args, ctx) => {
      requireCommandUI(ctx);
      const root = artifactRoot(ctx.cwd);
      await withFileMutationQueue(root, () => mkdir(root, { recursive: true }));
      await withFileMutationQueue(resolve(ctx.cwd, CONFIG_DIR_NAME, "workspace.json"), () => ensureWorkspaceConfig(ctx.cwd));
      await withFileMutationQueue(resolve(ctx.cwd, ".gitignore"), () => ensureGitignoreEntries(ctx.cwd, [DEFAULT_ROOT, `${CONFIG_DIR_NAME}/workspace.local.json`]));
      await ctx.ui.notify(`RPI ready: ${DEFAULT_ROOT} and ${CONFIG_DIR_NAME}/workspace.json`, "info");
    },
  });

  pi.registerCommand("rpi-new", {
    description: "Create a new RPI task from a work intent. The active LLM generates its title and slug.",
    handler: async (args, ctx) => {
      requireCommandUI(ctx);
      const intent = args.trim() || (await ctx.ui.editor("What do you want to accomplish?", ""))?.trim();
      if (!intent) {
        await ctx.ui.notify("Task intent is required.", "info");
        return;
      }
      const flowOptions = [
        { flow: "rpi", label: "RPI — research, design, outline, then implementation" },
        { flow: "prd", label: "PRD — research, requirements, tests, then implementation" },
        { flow: "oneshot", label: "One-shot — ticket directly to implementation" },
        { flow: "freeform", label: "Freeform — no enforced artifact chain" },
      ] as const;
      const selection = await ctx.ui.select("Select task flow:", flowOptions.map((option) => option.label));
      const flow = flowOptions.find((option) => option.label === selection)?.flow;
      if (!flow) return;
      pi.sendMessage({
        customType: "rpi-create-task-instruction",
        content: `Create and select exactly one new RPI task for this intent:\n\n${intent}\n\nCall rpi_create_task exactly once. Generate a concise human-readable title and a unique kebab-case slug. Use flow "${flow}", preserve the original intent verbatim in ticketBody, and do not ask follow-up questions.`,
        display: false,
      }, { triggerTurn: true });
    },
  });

  pi.registerCommand("rpi-task", {
    description: "Select the active task.",
    getArgumentCompletions: async (prefix: string) => {
      try {
        const entries = await readdir(artifactRoot(process.cwd()), { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).map((entry) => entry.name).sort().map((slug) => ({ value: slug, label: slug }));
      } catch {
        return [];
      }
    },
    handler: async (args, ctx) => {
      requireCommandUI(ctx);
      const root = artifactRoot(ctx.cwd);
      let slug = args.trim();
      if (!slug) {
        const tasks = [] as Array<{ slug: string; title: string; flow: string }>;
        try {
          const entries = await readdir(root, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifest = await tryLoadManifest(taskDir(root, entry.name));
            if (manifest) tasks.push({ slug: manifest.slug, title: manifest.title, flow: manifest.flow });
          }
        } catch { /* A missing artifact root has no selectable tasks. */ }
        tasks.sort((left, right) => left.slug.localeCompare(right.slug));
        if (tasks.length === 0) {
          await ctx.ui.notify("No tasks yet. Use /rpi-new.", "info");
          return;
        }
        const labels = tasks.map((task) => `${task.slug} · ${task.title} · ${task.flow}`);
        const choice = await ctx.ui.select("Select task:", labels);
        if (!choice) return;
        slug = tasks[labels.indexOf(choice)]!.slug;
      }
      const manifest = await tryLoadManifest(taskDir(root, slug));
      if (!manifest) {
        await ctx.ui.notify(`Task "${slug}" was not found. Use /rpi-new.`, "info");
        return;
      }
      selectTask(pi, ctx.cwd, slug);
      setActiveTaskFooter(ctx, manifest);
      await ctx.ui.notify(`Active task: ${slug}`, "info");
    },
  });

  pi.registerCommand("rpi-change-base", {
    description: "Select the active task's Git base branch.",
    handler: async (_args, ctx) => {
      requireCommandUI(ctx);
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task. Use /rpi-task.", "info");
        return;
      }
      const result = await pi.exec(
        "git",
        ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"],
        { cwd: ctx.cwd },
      );
      if (result.code !== 0) {
        await ctx.ui.notify("Could not list Git branches.", "error");
        return;
      }
      const refs = [...new Set(result.stdout.split("\n").map((ref) => ref.trim()).filter((ref) => ref && ref !== "origin/HEAD"))]
        .sort((left, right) => left.localeCompare(right));
      if (refs.length === 0) {
        await ctx.ui.notify("No Git branches are available.", "info");
        return;
      }
      const baseBranch = await ctx.ui.select("Select base branch:", refs);
      if (!baseBranch) return;
      const manifest = await loadManifest(active.taskDir);
      await withTaskMutationQueue(active.taskDir, () => setBaseBranch(manifest, baseBranch, active.taskDir));
      setActiveTaskFooter(ctx, manifest);
      await ctx.ui.notify(`Base branch: ${baseBranch}`, "info");
    },
  });

  pi.registerCommand("rpi-annotate", {
    description: "Annotate the active task's artifact folder with Plannotator.",
    handler: async (_args, ctx) => {
      requireCommandUI(ctx);
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task. Use /rpi-task <slug>.", "info");
        return;
      }
      const result = await withTaskMutationQueue(active.taskDir, () => pi.exec("plannotator", ["annotate", active.taskDir, "--json"]));
      if (result.code !== 0) {
        await ctx.ui.notify(result.stderr.trim() || result.stdout.trim() || "Plannotator annotation failed.", "error");
        return;
      }
      const outcome = parsePlannotatorAnnotationOutcome(result.stdout);
      if (!outcome) {
        await ctx.ui.notify("Plannotator returned invalid annotation data.", "error");
        return;
      }
      if (outcome.decision === "annotated" || (outcome.decision === "approved" && outcome.feedback)) {
        pi.sendUserMessage(plannotatorFeedbackPrompt(active.taskDir, outcome.feedback), { deliverAs: "followUp" });
        await ctx.ui.notify("Plannotator feedback queued.", "info");
        return;
      }
      if (outcome.decision === "approved") {
        await ctx.ui.notify("Plannotator annotation approved.", "info");
        return;
      }
      await ctx.ui.notify("Plannotator annotation dismissed.", "info");
    },
  });

  pi.registerCommand("rpi-status", {
    description: "Show the active task and its current stage + next action.",
    handler: async (_args, ctx) => {
      requireCommandUI(ctx);
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task. Use /rpi-task <slug>.", "info");
        return;
      }
      const manifest = await loadManifest(active.taskDir);
      await publishTaskStatus(pi, ctx, manifest);
    },
  });

  pi.registerCommand("rpi-artifacts", {
    description: "Render a textual graph of task artifacts, statuses, and the next action.",
    handler: async (_args, ctx) => {
      requireCommandUI(ctx);
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task.", "info");
        return;
      }
      const manifest = await loadManifest(active.taskDir);
      await publishTaskStatus(pi, ctx, manifest);
    },
  });

  pi.registerCommand("rpi-approve", {
    description: "Approve an artifact (moves it to approved with a receipt).",
    handler: async (args, ctx) => {
      requireCommandUI(ctx);
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task. Use /rpi-task.", "info");
        return;
      }
      const manifest = await loadManifest(active.taskDir);
      let artifactId = args.trim();
      if (!artifactId) {
        const eligible = manifest.artifacts.filter((artifact) => artifact.status === "in-review");
        if (eligible.length === 0) {
          await ctx.ui.notify("No artifacts are in review.", "info");
          return;
        }
        artifactId = await ctx.ui.select("Approve artifact:", eligible.map((artifact) => artifact.id)) ?? "";
        if (!artifactId) return;
      }
      await withTaskMutationQueue(active.taskDir, () => setArtifactStatus(manifest, artifactId, "approved", active.taskDir));
      setActiveTaskFooter(ctx, await loadManifest(active.taskDir));
      await ctx.ui.notify(`${artifactId} -> approved`, "info");
    },
  });

  // ---------------------------------------------------------------
  // Unmanaged-write warning into the artifact root
  // ---------------------------------------------------------------
  pi.on("tool_call", async (event, ctx) => {
    const isWrite = isToolCallEventType("write", event);
    const isEdit = isToolCallEventType("edit", event);
    if (isWrite || isEdit) {
      const raw = (event.input as { path?: unknown }).path;
      if (typeof raw === "string") {
        const target = resolveArtifactPath(ctx.cwd, raw);
        const rootBase = resolve(ctx.cwd, DEFAULT_ROOT);
        if (isWithinRoot(rootBase, target)) {
          return { block: true, reason: `RPI manages ${DEFAULT_ROOT}; use rpi_* tools instead of built-in write or edit.` };
        }
      }
    }
    if (isToolCallEventType("bash", event)) {
      const command = (event.input as { command?: unknown }).command;
      if (typeof command === "string") {
        const reason = gitAddBlockReason(command, ctx.cwd);
        if (reason) return { block: true, reason };
      }
    }
  });
}
