/**
 * M1 prototype: pi-subagents orchestration surfaces.
 *
 * Proves, from inside an extension:
 * - structured delegation (pi-subagents/delegation): one fresh read-only child,
 *   schema-validated structured result, child reaches the supervisor channel
 * - in-process RPC spawn with a managed worktree child (worktree: true)
 * - in-process RPC spawn with a two-child parallel fanout (runs.all)
 *
 * Markers: console.error("RPI_PROTO: ...") lines are greppable proof markers.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  SUBAGENT_DELEGATION_REQUEST_EVENT,
  SUBAGENT_DELEGATION_RESPONSE_EVENT,
  type SubagentDelegationRequest,
  type SubagentDelegationResponse,
} from "pi-subagents/delegation";

interface RpcReply {
  version: number;
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

function rpcCall(pi: ExtensionAPI, method: string, params: Record<string, unknown>): Promise<RpcReply> {
  return new Promise((resolvePromise, rejectPromise) => {
    const requestId = crypto.randomUUID();
    const eventName = `subagents:rpc:v1:reply:${requestId}`;
    const unsub = pi.events.on(eventName, (data: unknown) => {
      unsub();
      resolvePromise(data as RpcReply);
    });
    pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
    setTimeout(() => {
      unsub();
      rejectPromise(new Error(`RPC ${method} timed out`));
    }, 20_000);
  });
}

async function spawnAndWait(
  pi: ExtensionAPI,
  workflowScript: string,
): Promise<{ runId: string; state: string; payload: unknown }> {
  const spawn = await rpcCall(pi, "spawn", { workflowScript, context: "fresh" });
  if (!spawn.success) {
    throw new Error(`spawn failed: ${JSON.stringify(spawn.error)}`);
  }
  const data = (spawn.data ?? {}) as { runId?: string; id?: string };
  const runId = data.runId ?? data.id ?? "";
  if (!runId) {
    throw new Error(`spawn reply without runId: ${JSON.stringify(spawn.data)}`);
  }
  const deadline = Date.now() + 120_000;
  let state = "running";
  let payload: unknown = spawn.data;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await rpcCall(pi, "status", { id: runId });
    if (status.success) {
      payload = status.data;
      const st = (status.data as { state?: string }).state ?? "";
      if (st) state = st;
      if (["complete", "completed", "failed", "blocked", "stopped", "aborted"].includes(state)) {
        break;
      }
    }
  }
  return { runId, state, payload };
}

export default function delegationPrototype(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "rpi_proto_spawn",
    label: "Proto Spawn",
    description:
      "Spawn one fresh read-only child through pi-subagents structured delegation and return its schema-validated result.",
    promptSnippet: "rpi_proto_spawn — one structured-delegation child with a validated result",
    promptGuidelines: [
      "Use rpi_proto_spawn to prove structured delegation from an extension.",
    ],
    parameters: Type.Object({
      agent: StringEnum(["scout", "delegate", "oracle"] as const),
      task: Type.String({ description: "Task text for the child" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const request: SubagentDelegationRequest = {
        requestId: crypto.randomUUID(),
        ownerRunId: "rpi-proto",
        nodeId: "proto-spawn",
        agent: params.agent,
        task: params.task,
        context: "fresh",
        cwd: ctx.cwd,
        thinking: "low",
        result: {
          kind: "structured",
          schema: {
            type: "object",
            properties: { verdict: { type: "string" } },
            required: ["verdict"],
            additionalProperties: false,
          },
        },
      };
      const response = await new Promise<SubagentDelegationResponse>((resolvePromise, rejectPromise) => {
        const unsub = pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (data: unknown) => {
          const payload = data as SubagentDelegationResponse;
          if (payload.requestId !== request.requestId) return;
          unsub();
          resolvePromise(payload);
        });
        pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
        setTimeout(() => {
          unsub();
          rejectPromise(new Error("delegation timed out"));
        }, 90_000);
      });
      console.error(`RPI_PROTO_DELEGATE status=${response.status} node=${response.nodeId}`);
      if (response.status === "invalid_request") {
        throw new Error(`delegation invalid: ${response.error ?? "unknown"}`);
      }
      const value = response.result
        ? response.result.kind === "structured"
          ? JSON.stringify(response.result.value ?? null)
          : response.result.text
        : "null";
      return {
        content: [
          { type: "text", text: `Delegation ${response.status}: ${value}` },
        ],
        details: {
          status: response.status,
          result: response.result,
          runId: response.runId,
          usage: response.usage,
        },
      };
    },
  });

  pi.registerTool({
    name: "rpi_proto_worktree",
    label: "Proto Worktree",
    description:
      "Spawn one child with pi-subagents managed worktree isolation (worktree: true) and report its lifecycle outcome.",
    promptSnippet: "rpi_proto_worktree — one managed-worktree child",
    parameters: Type.Object({
      task: Type.String({ description: "Task text for the child" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const script = [
        'return runs.run("main", {',
        `  agent: "scout",`,
        `  task: ${JSON.stringify(params.task)},`,
        "  worktree: true",
        "})",
      ].join("\n");
      const result = await spawnAndWait(pi, script);
      console.error(`RPI_PROTO_WORKTREE runId=${result.runId} state=${result.state}`);
      return {
        content: [{ type: "text", text: `Worktree child ${result.state} (run ${result.runId})` }],
        details: { runId: result.runId, state: result.state, payload: result.payload },
      };
    },
  });

  pi.registerTool({
    name: "rpi_proto_fanout",
    label: "Proto Fanout",
    description:
      "Spawn two parallel fresh children via runs.all and report both outputs.",
    promptSnippet: "rpi_proto_fanout — two-child parallel fanout",
    parameters: Type.Object({
      task: Type.String({ description: "Shared task text for both children" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const script = [
        "return runs.all([",
        "  { key: \"a\", agent: \"scout\", task: " + JSON.stringify(`A: ${params.task}`) + " },",
        "  { key: \"b\", agent: \"scout\", task: " + JSON.stringify(`B: ${params.task}`) + " }",
        "])",
      ].join("\n");
      const result = await spawnAndWait(pi, script);
      console.error(`RPI_PROTO_FANOUT runId=${result.runId} state=${result.state}`);
      return {
        content: [{ type: "text", text: `Fanout ${result.state} (run ${result.runId})` }],
        details: { runId: result.runId, state: result.state, payload: result.payload },
      };
    },
  });
}
