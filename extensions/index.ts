/**
 * M1 prototype: core extension surfaces.
 *
 * Proves, in one package extension:
 * - registerTool with typebox StringEnum parameters, writing through withFileMutationQueue
 * - registerCommand with getArgumentCompletions
 * - tool_call warning for unmanaged writes into the artifact root
 * - setStatus + setWidget, re-rendered on both session_start and command runs
 * - before_agent_start message injection (participates in LLM context)
 * - state persistence via tool-result `details` + session_start restore (the canonical
 *   `todo.ts` pattern: store full state in tool result details, rebuild in session_start)
 *
 * Marker convention: console.error("RPI_PROTO: ...") lines are greppable proof
 * markers for non-interactive smoke runs.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ARTIFACT_ROOT, isWithinRoot, resolveArtifactPath } from "../src/paths.ts";

let protoCount = 0;

/** Rebuild in-memory state from session tool-result details (todo.ts pattern). */
function restoreProtoState(ctx: ExtensionContext): void {
  let count = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    if (entry.message.role !== "toolResult") continue;
    const details = entry.message.details as { count?: number } | undefined;
    if (details && typeof details.count === "number") {
      count = details.count;
    }
  }
  protoCount = count;
}

function renderProtoUi(ctx: ExtensionContext): void {
  ctx.ui.setStatus("rpi-proto", `proto count ${protoCount}`);
  ctx.ui.setWidget("rpi-proto", ["rpi-proto active", `appendEntry count: ${protoCount}`]);
}

export default function protoExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    restoreProtoState(ctx);
    renderProtoUi(ctx);
  });

  pi.on("before_agent_start", async (_event, _ctx) => {
    return {
      message: {
        customType: "rpi-proto",
        content:
          "Active task context (rpi-proto): task slug 'proto-demo', flow 'rpi', stage 'research'. If asked, report this context exactly.",
        display: true,
      },
    };
  });

  pi.registerTool({
    name: "rpi_proto_bump",
    label: "Proto Bump",
    description:
      "Increment the prototype counter and return it in tool-result details so session_start can restore it.",
    promptSnippet: "rpi_proto_bump — increment and persist the proto counter via details",
    promptGuidelines: ["Use rpi_proto_bump to advance the prototype counter state."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      protoCount += 1;
      return {
        content: [{ type: "text", text: `Proto count is now ${protoCount}` }],
        details: { count: protoCount },
      };
    },
  });

  pi.registerTool({
    name: "rpi_proto_write",
    label: "Proto Write",
    description:
      "Write a file inside the prototype artifact root (.pi/artifacts) through the file mutation queue. Use instead of the built-in write for artifact files.",
    promptSnippet: "rpi_proto_write — managed write into the prototype artifact store",
    promptGuidelines: [
      "Use rpi_proto_write instead of the built-in write tool for files under .pi/artifacts/.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "File name relative to the artifact root" }),
      content: Type.String({ description: "File content" }),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const root = resolve(ctx.cwd, ARTIFACT_ROOT);
      const target = resolve(root, params.name);
      if (!isWithinRoot(root, target)) {
        throw new Error(`Path escapes artifact root: ${params.name}`);
      }
      onUpdate?.({ content: [{ type: "text", text: "writing through mutation queue..." }], details: {} });
      const result = await withFileMutationQueue(target, async () => {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, params.content, "utf8");
        return { ok: true as const, path: target };
      });
      console.error(`RPI_PROTO_TOOL wrote ${params.name}`);
      return {
        content: [{ type: "text", text: `Wrote ${params.name} (${params.content.length} chars)` }],
        details: { path: result.path },
      };
    },
  });

  pi.registerCommand("rpi-proto", {
    description: "M1 prototype command with argument completions",
    getArgumentCompletions: (prefix: string) => {
      const items = ["alpha", "beta", "gamma"].map((value) => ({ value, label: value }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      protoCount += 1;
      pi.appendEntry("rpi-proto", { count: protoCount, args });
      renderProtoUi(ctx);
      ctx.ui.notify(`rpi-proto ran with args: ${args} (count ${protoCount})`, "info");
    },
  });
}
