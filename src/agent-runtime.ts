/**
 * Agent runtime launch adapters: builds pi-subagents fanout, one-phase
 * implementation, and deviation review from inside an extension.
 *
 * Uses the proven M1 RPC pattern. Returns a run receipt (runId + state +
 * collected payload) so the caller can persist it in the task manifest.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ResearchNode =
  | "artifact-locator"
  | "artifact-analyzer"
  | "artifact-pattern-finder"
  | "artifact-web-researcher";

export interface RunReceipt {
  runId: string;
  state: string;
  payload: unknown;
}

interface RpcReply {
  version: number;
  requestId: string;
  success: boolean;
  data?: { runId?: string; id?: string; state?: string; [k: string]: unknown } | null;
  error?: { code: string; message: string };
}

export function rpcCall(pi: ExtensionAPI, method: string, params: Record<string, unknown>): Promise<RpcReply> {
  return new Promise((resolvePromise, rejectPromise) => {
    const requestId = crypto.randomUUID();
    const eventName = `subagents:rpc:v1:reply:${requestId}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = pi.events.on(eventName, (data: unknown) => {
      if (timer) clearTimeout(timer);
      unsub();
      resolvePromise(data as RpcReply);
    });
    pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
    timer = setTimeout(() => {
      unsub();
      rejectPromise(new Error(`RPC ${method} timed out`));
    }, 20_000);
  });
}

async function waitForCompletion(pi: ExtensionAPI, runId: string, timeoutMs = 240_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let state = "running";
  let lastPayload: unknown;
  let deadlineHit = true;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await rpcCall(pi, "status", { id: runId });
    if (status.success && status.data?.state) {
      lastPayload = status.data;
      state = status.data.state;
      if (["complete", "completed", "failed", "blocked", "stopped", "aborted"].includes(state)) {
        deadlineHit = false;
        break;
      }
    }
  }
  if (deadlineHit && state === "running") {
    throw agentUnavailableError(
      new Error(`child run ${runId} did not reach a terminal state within ${timeoutMs}ms`),
    );
  }
  if (["failed", "blocked", "aborted"].includes(state)) {
    const text = JSON.stringify(lastPayload ?? "");
    if (/unknown agent|agent.*not.*regist|no such agent|invalid agent/i.test(text)) {
      throw agentUnavailableError(
        new Error(`child run ${runId} ended ${state}: ${text.slice(0, 400)}`),
      );
    }
  }
  return state;
}

/** Surface a friendly, actionable error when the package agents are not registered. */
export function agentUnavailableError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /unknown agent|agent.*not.*regist|no such agent|invalid agent|timed out|did not reach a terminal state/i.test(msg)
  ) {
    return new Error(
      `The pi-rpi agents could not run (${msg}). They are only discoverable when the package is installed (pi install <pkg> or pi install -l <pkg> for a project), not when loaded with -e. Install the package and ensure pi-subagents is present, then retry.`,
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/**
 * Research fanout: launch 2-6 parallel fresh read-only research children and
 * wait for all of them. Returns a run receipt linking the workflow run.
 */
export async function startResearch(
  pi: ExtensionAPI,
  nodes: ResearchNode[],
  tasks: string[],
  cwd: string,
): Promise<RunReceipt> {
  if (nodes.length < 2) throw new Error("Research fanout needs at least 2 nodes");
  if (nodes.length > 6) throw new Error("Research fanout caps at 6 nodes");
  if (nodes.length !== tasks.length) throw new Error("nodes and tasks length mismatch");

  const items = nodes
    .map((agent, i) => `{ key: "n${i}", agent: ${JSON.stringify(agent)}, task: ${JSON.stringify(tasks[i] ?? "")}, context: "fresh", cwd: ${JSON.stringify(cwd)} }`)
    .join(",\n        ");
  const script = `return runs.all([\n        ${items}\n      ])`;
  const spawn = await rpcCall(pi, "spawn", { workflowScript: script, context: "fresh" });
  if (!spawn.success) throw agentUnavailableError(new Error(`research spawn failed: ${JSON.stringify(spawn.error)}`));
  const runId = spawn.data?.runId ?? spawn.data?.id ?? "";
  if (!runId) throw new Error(`research spawn reply without runId: ${JSON.stringify(spawn.data)}`);
  const state = await waitForCompletion(pi, runId);
  return { runId, state, payload: { nodes, tasks } };
}

/**
 * One-phase implementation: spawn a single implementer child for one phase.
 * The parent verifies afterwards and gates on the human.
 */
export async function implementPhase(
  pi: ExtensionAPI,
  agent: "artifact-implementer" | "artifact-outline-implementer",
  phaseTask: string,
  cwd: string,
): Promise<RunReceipt> {
  const script = `return runs.run("main", { agent: ${JSON.stringify(agent)}, task: ${JSON.stringify(phaseTask)}, context: "fresh", cwd: ${JSON.stringify(cwd)} })`;
  const spawn = await rpcCall(pi, "spawn", { workflowScript: script, context: "fresh" });
  if (!spawn.success) throw agentUnavailableError(new Error(`implement spawn failed: ${JSON.stringify(spawn.error)}`));
  const runId = spawn.data?.runId ?? spawn.data?.id ?? "";
  if (!runId) throw new Error(`implement spawn reply without runId: ${JSON.stringify(spawn.data)}`);
  const state = await waitForCompletion(pi, runId);
  return { runId, state, payload: { phaseTask } };
}

/**
 * Deviation review: one fresh read-only reviewer comparing the plan to base...HEAD.
 */
export async function reviewImplementation(
  pi: ExtensionAPI,
  task: string,
  cwd: string,
): Promise<RunReceipt> {
  const script = `return runs.run("main", { agent: "artifact-implementation-reviewer", task: ${JSON.stringify(task)}, context: "fresh", cwd: ${JSON.stringify(cwd)} })`;
  const spawn = await rpcCall(pi, "spawn", { workflowScript: script, context: "fresh" });
  if (!spawn.success) throw agentUnavailableError(new Error(`review spawn failed: ${JSON.stringify(spawn.error)}`));
  const runId = spawn.data?.runId ?? spawn.data?.id ?? "";
  if (!runId) throw new Error(`review spawn reply without runId: ${JSON.stringify(spawn.data)}`);
  const state = await waitForCompletion(pi, runId);
  return { runId, state, payload: { task } };
}
