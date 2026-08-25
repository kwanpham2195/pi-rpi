/**
 * Extension adapter: builds the task-manifest protocol into pi tools, commands,
 * context injection, and TUI. Thin adapters over the engine (src/engine).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
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
  FLOW_CHAINS,
  type TaskManifest,
} from "../src/engine/index.ts";
import { isWithinRoot, resolveArtifactPath } from "../src/paths.ts";
import { implementPhase, reviewImplementation, startResearch } from "../src/agent-runtime.ts";

export const DEFAULT_ROOT = ".pi/artifacts";
const FOOTER_OPTIONAL_ARTIFACT_TYPES = new Set(["ticket", "plan", "mockup", "diagram", "pr-walkthrough"]);
const DEFAULT_WORKSPACE_CONFIG = {
  disabled: false,
  pathTemplate: "~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  branchTemplate: "{{ TASKSLUG }}",
  repos: [{
    localPath: ".",
    primary: true,
    sourceRef: "origin/main",
    setupCommand: "",
    copyGlobs: [".env*", ".pi/settings.json", ".pi/workspace.local.json"],
  }],
};

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
  const path = resolve(cwd, ".pi", "workspace.json");
  try {
    await writeFile(path, `${JSON.stringify(DEFAULT_WORKSPACE_CONFIG, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !((error as NodeJS.ErrnoException).code === "EEXIST")) throw error;
  }
}
const execFileAsync = promisify(execFile);
const MAX_TOOL_TEXT = 12_000;

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
const selectedTasks = new WeakMap<ExtensionAPI, { slug: string; taskDir: string }>();

/** Root of all task artifacts for a project. */
function artifactRoot(cwd: string): string {
  return resolve(cwd, DEFAULT_ROOT);
}

/** Return the next required flow stage in the compact task footer. */
function nextFooterStage(manifest: TaskManifest): string {
  for (const type of FLOW_CHAINS[manifest.flow]) {
    if (FOOTER_OPTIONAL_ARTIFACT_TYPES.has(type)) continue;
    const hasApprovedArtifact = manifest.artifacts.some((artifact) => artifact.type === type && artifact.status === "approved");
    if (!hasApprovedArtifact) return type === "research-questions" ? "research" : type;
  }
  return "complete";
}

/** Update Pi's built-in footer with the selected task's current workflow state. */
function setActiveTaskFooter(ctx: ExtensionContext, manifest: TaskManifest): void {
  const inReview = manifest.artifacts.filter((artifact) => artifact.status === "in-review").length;
  ctx.ui.setStatus("rpi-active", `${manifest.slug} · ${manifest.flow} · next: ${nextFooterStage(manifest)} · ${inReview} in review`);
}

function taskDir(root: string, slug: string): string {
  validateSlug(slug);
  return resolve(root, slug);
}

async function currentTask(pi: ExtensionAPI, ctx: ExtensionContext): Promise<{ slug: string; taskDir: string } | null> {
  const selected = selectedTasks.get(pi);
  if (selected) return selected;
  // Reconstruct the selected task from tool-result details (M1 pattern).
  // Scan in reverse so the LATEST selection wins (getBranch is chronological).
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
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
      const restored = { slug: details.taskSlug, taskDir: taskDir(artifactRoot(ctx.cwd), details.taskSlug) };
      selectedTasks.set(pi, restored);
      return restored;
    }
  }
  return null;
}

function selectTask(pi: ExtensionAPI, cwd: string, slug: string): void {
  selectedTasks.set(pi, { slug, taskDir: taskDir(artifactRoot(cwd), slug) });
}

function boundedToolText(text: string): string {
  return text.length <= MAX_TOOL_TEXT ? text : `${text.slice(0, MAX_TOOL_TEXT)}\n\n[Output truncated at ${MAX_TOOL_TEXT} characters.]`;
}


function runPayloadText(payload: unknown): string {
  if (payload !== null && typeof payload === "object" && "text" in payload && typeof payload.text === "string") return payload.text;
  return JSON.stringify(payload);
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
  // ---------------------------------------------------------------
  // Context injection: current active task.
  // ---------------------------------------------------------------
  pi.on("before_agent_start", async (_event, ctx) => {
    const active = await currentTask(pi, ctx);
    if (!active) return;
    const manifest = await tryLoadManifest(active.taskDir);
    if (manifest) setActiveTaskFooter(ctx, manifest);
    return {
      message: {
        customType: "rpi-active-task",
        content: `Active task: ${active.slug}. Task artifacts live in .pi/artifacts/${active.slug}. Use the rpi_* tools to create/read/update artifacts.`,
        display: true,
      },
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
      const manifest = await createTask(root, {
        slug: params.slug,
        title: params.title,
        flow: params.flow,
        baseBranch: params.baseBranch ?? "main",
        ticketBody: params.ticketBody,
        ticketUrl: params.ticketUrl,
      });
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
      return { content: [{ type: "text", text: boundedToolText(lines.join("\n")) }], details: {} };
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
      const content = await readArtifact(taskDir(root, slug), artifactInfo.id);
      return { content: [{ type: "text", text: boundedToolText(content) }], details: { artifactId: params.artifactId } };
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
      const created = await createArtifact(active.taskDir, {
        type: params.type,
        description: params.description,
        content: params.content,
        dependsOn: params.dependsOn,
        status: params.status,
        supersedes: params.supersedes,
      });
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
      // Resolve the active artifact, then route the write through the engine
      // (containment check + per-task lock) and pi's mutation queue.
      const manifest = await loadManifest(active.taskDir);
      const artifactInfo = findArtifact(manifest, params.artifactId);
      if (!artifactInfo) throw new Error(`Artifact "${params.artifactId}" not found.`);
      const queuePath = join(active.taskDir, artifactInfo.path);
      const contentHash = await withFileMutationQueue(queuePath, async () => {
        const result = await updateArtifact(active.taskDir, params.artifactId, params.content);
        return result.artifact.contentHash;
      });
      setActiveTaskFooter(ctx, await loadManifest(active.taskDir));
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
      await setArtifactStatus(manifest, params.artifactId, params.status, active.taskDir);
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
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const receipt = await startResearch(pi, params.nodes as never, params.tasks, ctx.cwd, { signal, onSpawn: async (runId) => {
        await recordTaskRun(active.taskDir, runId, "research fanout");
      } });
      return {
        content: [
          { type: "text" as const, text: boundedToolText(`Research fanout run ${receipt.runId} ${receipt.state} across ${params.nodes.length} nodes.\n\n${runPayloadText(receipt.payload)}`) },
        ],
        details: { runId: receipt.runId, state: receipt.state, nodes: params.nodes },
      };
    },
  });

  pi.registerTool({
    name: "rpi_implement_phase",
    label: "RPI Implement Phase",
    description:
      "Launch a single implementer agent (artifact-implementer or artifact-outline-implementer) for exactly one phase of the active task. The parent verifies automated checks afterwards and gates on the human.",
    promptSnippet: "rpi_implement_phase — run one implementation phase",
    promptGuidelines: [
      "Use rpi_implement_phase for exactly one phase at a time with a single writer; run automated checks after and present the manual-verification gate.",
    ],
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase id from the plan/structure outline" }),
      agent: StringEnum(["artifact-implementer", "artifact-outline-implementer"] as const),
      phaseTask: Type.String({ description: "Task text describing the phase to implement" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const receipt = await implementPhase(pi, params.agent, params.phaseTask, ctx.cwd, { signal, onSpawn: async (runId) => {
        await recordTaskRun(active.taskDir, runId, `implementation phase ${params.phaseId}`);
      } });
      return {
        content: [
          { type: "text" as const, text: boundedToolText(`Phase ${params.phaseId} implementation run ${receipt.runId} ${receipt.state}.\n\n${runPayloadText(receipt.payload)}`) },
        ],
        details: { runId: receipt.runId, state: receipt.state, phaseId: params.phaseId },
      };
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
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const receipt = await reviewImplementation(pi, params.reviewTask, ctx.cwd, { signal, onSpawn: async (runId) => {
        await recordTaskRun(active.taskDir, runId, "implementation review");
      } });
      return {
        content: [
          { type: "text" as const, text: boundedToolText(`Implementation review run ${receipt.runId} ${receipt.state}.\n\n${runPayloadText(receipt.payload)}`) },
        ],
        details: { runId: receipt.runId, state: receipt.state },
      };
    },
  });

  pi.registerTool({
    name: "rpi_record_phase_commit",
    label: "RPI Record Phase Commit",
    description: "Record a verified Git commit for a completed implementation phase.",
    parameters: Type.Object({ phaseId: Type.String(), runId: Type.String(), commitSha: Type.String() }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      if (!/^[0-9a-f]{7,64}$/i.test(params.commitSha)) throw new Error("commitSha must be a Git object ID.");
      let commitSha: string;
      try { ({ stdout: commitSha } = await execFileAsync("git", ["rev-parse", "--verify", `${params.commitSha}^{commit}`], { cwd: ctx.cwd })); }
      catch { throw new Error(`Commit ${params.commitSha} does not exist in this repository.`); }
      const canonicalCommitSha = commitSha.trim();
      await recordPhaseCommit(active.taskDir, params.phaseId, params.runId, canonicalCommitSha);
      return { content: [{ type: "text", text: `Recorded commit ${canonicalCommitSha} for phase ${params.phaseId}.` }], details: { ...params, commitSha: canonicalCommitSha } };
    },
  });

  pi.registerTool({
    name: "rpi_git_diff",
    label: "RPI Git Diff",
    description: "Read a bounded diff from an existing base ref to HEAD for implementation review.",
    parameters: Type.Object({ baseRef: Type.String({ description: "Existing Git base ref" }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!/^[A-Za-z0-9._/@-]+$/.test(params.baseRef)) throw new Error("baseRef contains unsupported characters.");
      try { await execFileAsync("git", ["rev-parse", "--verify", `${params.baseRef}^{commit}`], { cwd: ctx.cwd }); }
      catch { throw new Error(`Base ref ${params.baseRef} does not exist.`); }
      const outputDir = await mkdtemp(join(tmpdir(), "rpi-git-diff-"));
      const outputPath = join(outputDir, "diff.txt");
      try {
        await execFileAsync("git", ["diff", "--no-ext-diff", "--unified=3", `--output=${outputPath}`, `${params.baseRef}...HEAD`], { cwd: ctx.cwd });
        return { content: [{ type: "text", text: boundedToolText(await readFile(outputPath, "utf8")) }], details: { baseRef: params.baseRef } };
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
  });

  // Commands
  // ---------------------------------------------------------------
  pi.registerCommand("rpi-init", {
    description: "Initialize artifacts and the default shared worktree configuration. Idempotent.",
    handler: async (_args, ctx) => {
      const root = artifactRoot(ctx.cwd);
      await mkdir(resolve(root), { recursive: true });
      await ensureWorkspaceConfig(ctx.cwd);
      await ensureGitignoreEntries(ctx.cwd, [DEFAULT_ROOT, ".pi/workspace.local.json"]);
      await ctx.ui.notify(`RPI ready: ${DEFAULT_ROOT} and .pi/workspace.json`, "info");
    },
  });

  pi.registerCommand("rpi-new", {
    description: "Create a new RPI task from a work intent. The active LLM generates its title and slug.",
    handler: async (args, ctx) => {
      const intent = args.trim() || (await ctx.ui.editor("What do you want to accomplish?", ""))?.trim();
      if (!intent) {
        await ctx.ui.notify("Task intent is required.", "info");
        return;
      }
      const flow = await ctx.ui.select("Select task flow:", ["rpi", "prd", "oneshot", "freeform"]);
      if (!flow) return;
      pi.sendUserMessage(`Create and select exactly one new RPI task for this intent:\n\n${intent}\n\nCall rpi_create_task exactly once. Generate a concise human-readable title and a unique kebab-case slug. Use flow "${flow}", preserve the original intent verbatim in ticketBody, and do not ask follow-up questions.`);
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
      await setBaseBranch(manifest, baseBranch, active.taskDir);
      setActiveTaskFooter(ctx, manifest);
      await ctx.ui.notify(`Base branch: ${baseBranch}`, "info");
    },
  });

  pi.registerCommand("rpi-annotate", {
    description: "Annotate the active task's artifact folder with Plannotator.",
    handler: async (_args, ctx) => {
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task. Use /rpi-task <slug>.", "info");
        return;
      }
      const result = await pi.exec("plannotator", ["annotate", active.taskDir, "--json"]);
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
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task. Use /rpi-task <slug>.", "info");
        return;
      }
      const manifest = await loadManifest(active.taskDir);
      const stages = manifest.artifacts
        .filter((a) => a.type !== "ticket")
        .map((a) => `${a.type}:${a.status}`);
      const stageText = stages.join("   ") || "(none yet)";
      await ctx.ui.notify(
        `Task ${active.slug} (${manifest.flow})\nStages: ${stageText}\nNext: create the next artifact for the ${manifest.flow} flow.`,
        "info",
      );
    },
  });

  pi.registerCommand("rpi-artifacts", {
    description: "Render a textual graph of task artifacts, statuses, and the next action.",
    handler: async (_args, ctx) => {
      const active = await currentTask(pi, ctx);
      if (!active) {
        await ctx.ui.notify("No active task.", "info");
        return;
      }
      const manifest = await loadManifest(active.taskDir);
      const lines = [`# ${active.slug} (${manifest.flow})`];
      for (const a of manifest.artifacts) {
        lines.push(`  [${a.status}] ${a.path}`);
      }
      await ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("rpi-approve", {
    description: "Approve an artifact (moves it to approved with a receipt).",
    handler: async (args, ctx) => {
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
      await setArtifactStatus(manifest, artifactId, "approved", active.taskDir);
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
          ctx.ui.notify(`Unmanaged write into artifact root: ${raw}. Prefer rpi_* tools.`, "warning");
          console.error(`RPI_WARN unmanaged artifact write: ${raw}`);
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
