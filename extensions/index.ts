/**
 * M1 prototype: core extension surfaces.
 *
 * Proves, in one package extension:
 * - registerTool with typebox StringEnum parameters, writing through withFileMutationQueue
 * - registerCommand with getArgumentCompletions
 * - tool_call warning for unmanaged writes into the artifact root
 * - setStatus + setWidget
 * - before_agent_start message injection (participates in LLM context)
 * - appendEntry persistence + session_start restore
 *
 * Marker convention: console.error("RPI_PROTO: ...") lines are greppable proof
 * markers for non-interactive smoke runs.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ARTIFACT_ROOT, isWithinRoot, resolveArtifactPath } from "../src/paths.ts";

let protoCount = 0;

function restoreProtoState(ctx: ExtensionContext): void {
  let count = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === "rpi-proto") {
      count = (entry.data as { count?: number } | undefined)?.count ?? 0;
    }
  }
  protoCount = count;
}

export default function protoExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    restoreProtoState(ctx);
    ctx.ui.setStatus("rpi-proto", `proto count ${protoCount}`);
    ctx.ui.setWidget("rpi-proto", ["rpi-proto active", `appendEntry count: ${protoCount}`]);
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

  pi.on("tool_call", async (event, ctx) => {
    const isWrite = isToolCallEventType("write", event);
    const isEdit = isToolCallEventType("edit", event);
    if (!isWrite && !isEdit) return;
    const raw = (event.input as { path?: unknown }).path;
    if (typeof raw !== "string") return;
    const root = resolve(ctx.cwd, ARTIFACT_ROOT);
    const target = resolveArtifactPath(ctx.cwd, raw);
    if (isWithinRoot(root, target)) {
      console.error(`RPI_PROTO_WARN unmanaged write into artifact root: ${raw}`);
      ctx.ui.notify(`Unmanaged write into artifact root: ${raw}`, "warning");
    }
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
      ctx.ui.notify(`rpi-proto ran with args: ${args} (count ${protoCount})`, "info");
    },
  });
}
