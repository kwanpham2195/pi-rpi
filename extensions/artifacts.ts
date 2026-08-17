/**
 * Extension adapter: builds the task-manifest protocol into pi tools, commands,
 * context injection, and TUI. Thin adapters over the engine (src/engine).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { resolve, join, relative } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  EngineError,
  createArtifact,
  createTask,
  loadManifest,
  openTask,
  saveManifest,
  setArtifactStatus,
  changeFlow,
  hashFile,
  manifestPath,
  tryLoadManifest,
  updateArtifact,
} from "../src/engine/index.ts";
import { isWithinRoot, resolveArtifactPath } from "../src/paths.ts";

export const DEFAULT_ROOT = ".pi/artifacts";

/** Root of all task artifacts for a project. */
function artifactRoot(cwd: string): string {
  return resolve(cwd, DEFAULT_ROOT);
}

function taskDir(root: string, slug: string): string {
  return resolve(root, slug);
}

async function currentTask(pi: ExtensionAPI, ctx: ExtensionContext): Promise<{ slug: string; taskDir: string } | null> {
  // Reconstruct the selected task from tool-result details (M1 pattern).
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "toolResult") continue;
    const details = entry.message.details as { taskSlug?: string } | undefined;
    if (details?.taskSlug) return { slug: details.taskSlug, taskDir: taskDir(artifactRoot(ctx.cwd), details.taskSlug) };
  }
  return null;
}

export default function artifactsExtension(pi: ExtensionAPI): void {
  // ---------------------------------------------------------------
  // Context injection: tell the agent which task is active.
  // ---------------------------------------------------------------
  pi.on("before_agent_start", async (_event, ctx) => {
    const active = await currentTask(pi, ctx);
    return {
      message: {
        customType: "rpi-active-task",
        content: active
          ? `Active task: ${active.slug}. Task artifacts live in .pi/artifacts/${active.slug}. Use the rpi_* tools to create/read/update artifacts.`
          : "No active task. Use /rpi-task <slug> or rpi_get_task_context to select one.",
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const manifest = await createTask(root, {
        slug: params.slug,
        title: params.title,
        flow: params.flow,
        baseBranch: params.baseBranch ?? "main",
        ticketBody: params.ticketBody,
      });
      ctx.ui.setStatus("rpi-active", `${params.slug} · ${params.flow}`);
      ctx.ui.setWidget("rpi-active", [`Task ${params.slug} (${params.flow})`, "next: create research-questions"]);
      return {
        content: [{ type: "text", text: `Task created/selected: ${params.slug} (${params.flow})` }],
        details: { taskSlug: params.slug, flow: params.flow },
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
      // Reflect the active task in the TUI status + widget.
      const next = manifest.artifacts
        .filter((a) => a.type !== "ticket" && a.status !== "approved" && a.status !== "superseded")
        .map((a) => a.type)
        .join(", ");
      ctx.ui.setStatus("rpi-active", `${params.slug} · ${manifest.flow}`);
      ctx.ui.setWidget("rpi-active", [`Task ${params.slug} (${manifest.flow})`, `next: ${next || "none"}`]);
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
      return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
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
      const artifactInfo = manifest.artifacts.find((a) => a.id === params.artifactId);
      if (!artifactInfo) throw new Error(`Artifact "${params.artifactId}" not found.`);
      const content = await readFile(join(taskDir(root, slug), artifactInfo.path), "utf8");
      return { content: [{ type: "text", text: content }], details: { artifactId: params.artifactId } };
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
      ] as const),
      description: Type.String({ description: "2-4 word kebab slug for the filename, e.g. parent-child-tracking" }),
      content: Type.String({ description: "Full markdown content of the document" }),
      dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Artifact ids this depends on" })),
      status: Type.Optional(StringEnum(["draft", "in-review", "approved"] as const)),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = artifactRoot(ctx.cwd);
      const active = await currentTask(pi, ctx);
      if (!active) throw new Error("No task selected. First call rpi_get_task_context.");
      const manifest = await loadManifest(active.taskDir);
      const result = await createArtifact(active.taskDir, manifest, {
        type: params.type,
        description: params.description,
        content: params.content,
        dependsOn: params.dependsOn,
        status: params.status,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created ${params.type} at ${result.artifact.path} in task ${active.slug}.`,
          },
        ],
        details: { artifactId: result.artifact.id, path: result.artifact.path },
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
      const manifest = await loadManifest(active.taskDir);
      const artifactInfo = manifest.artifacts.find((a) => a.id === params.artifactId);
      if (!artifactInfo) throw new Error(`Artifact "${params.artifactId}" not found.`);
      const abs = join(active.taskDir, artifactInfo.path);
      await withFileMutationQueue(abs, async () => {
        await writeFile(abs, params.content, "utf8");
      });
      const contentHash = await hashFile(abs);
      artifactInfo.contentHash = contentHash;
      artifactInfo.updatedAt = new Date().toISOString();
      await saveManifest(active.taskDir, manifest);
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
      return {
        content: [{ type: "text", text: `${params.artifactId} -> ${params.status}` }],
        details: { artifactId: params.artifactId, status: params.status },
      };
    },
  });

  // ---------------------------------------------------------------
  // Agent-launch tools stubs: validate + report (adapters land in M4)
  // ---------------------------------------------------------------
  const agentRuntimeStub = {
    execute: async (_toolCallId: string, params: unknown) => {
      return {
        content: [
          {
            type: "text" as const,
            text: `rpi_agent tool: pi-subagents launch adapter pending (M4). Provided inputs:\n${JSON.stringify(params, null, 2)}`,
          },
        ],
        details: { pending: true },
      };
    },
  };

  pi.registerTool({
    name: "rpi_start_research",
    label: "RPI Start Research",
    description:
      "Launch the research fanout (2-6 parallel read-only children) for the active task. M4 runtime.",
    promptSnippet: "rpi_start_research — launch research fanout",
    parameters: Type.Object({
      slug: Type.Optional(Type.String({ description: "Task slug (defaults to selected task)" })),
      nodes: Type.Optional(Type.Number({ description: "Number of research children (2-6)" })),
    }),
    ...agentRuntimeStub,
  });

  pi.registerTool({
    name: "rpi_implement_phase",
    label: "RPI Implement Phase",
    description: "Launch one implementer agent for one phase of the active task. M4 runtime.",
    promptSnippet: "rpi_implement_phase — run one implementation phase",
    parameters: Type.Object({
      phaseId: Type.String({ description: "Phase id from the plan/structure outline" }),
    }),
    ...agentRuntimeStub,
  });

  pi.registerTool({
    name: "rpi_review_implementation",
    label: "RPI Review Implementation",
    description: "Launch a fresh reviewer to compare the plan against base...HEAD. M4 runtime.",
    promptSnippet: "rpi_review_implementation — plan-vs-implementation review",
    parameters: Type.Object({
      planArtifactId: Type.Optional(Type.String({ description: "Plan artifact id" })),
    }),
    ...agentRuntimeStub,
  });

  // ---------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------
  pi.registerCommand("rpi-init", {
    description: "Initialize the artifact root (.pi/artifacts) and add it to .gitignore. Idempotent.",
    handler: async (_args, ctx) => {
      const root = artifactRoot(ctx.cwd);
      await mkdir(resolve(root), { recursive: true });
      // gitignore entry
      const gi = resolve(ctx.cwd, ".gitignore");
      try {
        const existing = await readFile(gi, "utf8");
        if (!existing.split("\n").includes(DEFAULT_ROOT)) {
          await writeFile(gi, `${existing.replace(/\s*$/, "\n")}${DEFAULT_ROOT}\n`, "utf8");
        }
      } catch {
        await writeFile(ctx.cwd + "/.gitignore", `${DEFAULT_ROOT}\n`, "utf8");
      }
      await ctx.ui.notify(`Artifact root ready at ${DEFAULT_ROOT}`, "info");
    },
  });

  pi.registerCommand("rpi-task", {
    description: "Select or create the active task.",
    getArgumentCompletions: async (prefix: string) => {
      // list existing task slugs from the artifact root
      return [{ value: prefix || "eng-1234-example", label: prefix || "eng-1234-example" }];
    },
    handler: async (args, ctx) => {
      // Select existing or create a minimal shell
      const slug = args.trim();
      if (!slug) throw new Error("Usage: /rpi-task <slug>");
      const root = artifactRoot(ctx.cwd);
      const dir = taskDir(root, slug);
      const existing = await tryLoadManifest(dir);
      if (!existing) {
        // create a minimal task (default rpi flow). Real creation is via rpi_get_task_context or a create flow.
        await createTask(root, { slug, title: slug, flow: "rpi", baseBranch: "main" });
      }
      ctx.ui.setStatus("rpi-active", `${slug} · rpi`);
      ctx.ui.setWidget("rpi-active", [`Task ${slug} (rpi)`, "next: create research-questions"]);
      await ctx.ui.notify(`Active task: ${slug}`, "info");
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
      if (!active) throw new Error("No active task.");
      const artifactId = args.trim();
      const manifest = await loadManifest(active.taskDir);
      await setArtifactStatus(manifest, artifactId, "approved", active.taskDir);
      await ctx.ui.notify(`${artifactId} -> approved`, "info");
    },
  });

  // ---------------------------------------------------------------
  // Unmanaged-write warning into the artifact root
  // ---------------------------------------------------------------
  pi.on("tool_call", async (event, ctx) => {
    const isWrite = isToolCallEventType("write", event);
    const isEdit = isToolCallEventType("edit", event);
    if (!isWrite && !isEdit) return;
    const raw = (event.input as { path?: unknown }).path;
    if (typeof raw !== "string") return;
    const target = resolveArtifactPath(ctx.cwd, raw);
    const rootBase = resolve(ctx.cwd, DEFAULT_ROOT);
    if (isWithinRoot(rootBase, target)) {
      ctx.ui.notify(`Unmanaged write into artifact root: ${raw}. Prefer rpi_* tools.`, "warning");
      console.error(`RPI_WARN unmanaged artifact write: ${raw}`);
    }
  });
}
