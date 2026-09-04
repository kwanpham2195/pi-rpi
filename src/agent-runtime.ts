/** Launch adapters for pi-subagents RPC. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ResearchNode = "artifact-locator" | "artifact-analyzer" | "artifact-pattern-finder" | "artifact-web-researcher";
export interface RunReceipt { runId: string; state: string; payload: unknown; }
/** A spawned child run's current state, emitted after spawn and after every nonterminal poll. */
export interface RunProgress { runId: string; state: string; pollCount: number; }
export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onSpawn?: (runId: string) => Promise<void>;
  onProgress?: (progress: RunProgress) => Promise<void> | void;
  /** Test and integration tuning; production polling defaults to two seconds. */
  pollIntervalMs?: number;
  /** Wait briefly for the richer completion event after terminal status. */
  completionGraceMs?: number;
}

export interface ImplementationPhaseOptions extends RunOptions {
  phaseId?: string;
}

type RpcData = { text?: string; details?: Record<string, unknown>; isError?: boolean; [key: string]: unknown };
type RpcReply = { version: 1; requestId: string; method?: string; success: true; data: RpcData } | { version: 1; requestId: string; method?: string; success: false; error: { code: string; message: string } };

/** Call pi-subagents RPC and parse its public envelope before use. */
export function rpcCall(pi: ExtensionAPI, method: string, params: Record<string, unknown>, options: RunOptions = {}): Promise<RpcReply> {
  return new Promise((resolvePromise, rejectPromise) => {
    const requestId = crypto.randomUUID();
    const eventName = `subagents:rpc:v1:reply:${requestId}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      options.signal?.removeEventListener("abort", abort);
    };
    const finish = (action: () => void) => { if (!settled) { settled = true; cleanup(); action(); } };
    const abort = () => finish(() => rejectPromise(abortError()));
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    unsubscribe = pi.events.on(eventName, (raw: unknown) => {
      try {
        const reply = parseRpcReply(raw, requestId);
        finish(() => resolvePromise(reply));
      } catch (cause: unknown) {
        finish(() => rejectPromise(cause));
      }
    });
    timer = setTimeout(() => finish(() => rejectPromise(new Error(`RPC ${method} timed out`))), options.timeoutMs ?? 20_000);
    try {
      pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
    } catch (cause: unknown) {
      finish(() => rejectPromise(cause));
    }
  });
}

function parseRpcReply(raw: unknown, expectedRequestId: string): RpcReply {
  if (!isRecord(raw) || raw.version !== 1 || raw.requestId !== expectedRequestId || typeof raw.success !== "boolean") {
    throw new Error("Invalid pi-subagents RPC reply envelope.");
  }
  if (!raw.success) {
    if (!isRecord(raw.error) || typeof raw.error.code !== "string" || typeof raw.error.message !== "string") throw new Error("Invalid pi-subagents RPC error reply.");
    return { version: 1, requestId: expectedRequestId, ...(typeof raw.method === "string" ? { method: raw.method } : {}), success: false, error: { code: raw.error.code, message: raw.error.message } };
  }
  if (!isRecord(raw.data) || (raw.data.text !== undefined && typeof raw.data.text !== "string") || (raw.data.details !== undefined && !isRecord(raw.data.details))) {
    throw new Error("Invalid pi-subagents RPC success reply.");
  }
  return { version: 1, requestId: expectedRequestId, ...(typeof raw.method === "string" ? { method: raw.method } : {}), success: true, data: raw.data as RpcData };
}

const RUN_STATES = new Set(["queued", "running", "complete", "failed", "paused", "stopped", "rejected"]);
const TERMINAL_STATES = new Set(["complete", "failed", "paused", "stopped", "rejected"]);
const MAX_COMPLETION_OUTPUT = 12_000;

type Completion = { state: string; payload: unknown };

async function waitForCompletion(pi: ExtensionAPI, runId: string, options: RunOptions): Promise<Completion> {
  const deadline = Date.now() + (options.timeoutMs ?? 240_000);
  const controller = new AbortController();
  let completion: Completion | undefined;
  let pollCount = 0;
  const abort = () => controller.abort();
  const unsubscribe = pi.events.on("subagent:async-complete", (raw: unknown) => {
    const parsed = completionFromEvent(raw, runId);
    if (!parsed) return;
    completion = parsed;
    controller.abort();
  });
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (Date.now() < deadline) {
      await delay(Math.min(Math.max(0, options.pollIntervalMs ?? 2_000), Math.max(0, deadline - Date.now())), controller.signal);
      if (completion) return completion;
      const status = await rpcCall(pi, "status", { id: runId }, { ...options, signal: controller.signal });
      if (completion) return completion;
      if (!status.success) throw new Error(`child status failed: ${status.error.message}`);
      const state = stateFromStatus(status.data, runId);
      pollCount += 1;
      if (!TERMINAL_STATES.has(state)) await options.onProgress?.({ runId, state, pollCount });
      if (TERMINAL_STATES.has(state)) {
        const eventCompletion = await waitForCompletionEventGrace(() => completion, controller.signal, deadline, options);
        if (eventCompletion) return eventCompletion;
        if (isUnknownAgentFailure(state, status.data)) {
          throw agentUnavailableError(new Error(`child run ${runId} ended ${state}: ${JSON.stringify(status.data).slice(0, 400)}`));
        }
        return { state, payload: status.data };
      }
    }
    throw new Error(`child run ${runId} did not reach a terminal state within ${options.timeoutMs ?? 240_000}ms`);
  } catch (cause: unknown) {
    if (completion) return completion;
    await interruptThenStopOwnedRun(pi, runId);
    throw agentUnavailableError(cause);
  } finally {
    unsubscribe();
    options.signal?.removeEventListener("abort", abort);
  }
}

async function waitForCompletionEventGrace(
  completion: () => Completion | undefined,
  signal: AbortSignal,
  deadline: number,
  options: RunOptions,
): Promise<Completion | undefined> {
  if (completion()) return completion();
  const graceMs = Math.min(Math.max(0, options.completionGraceMs ?? 2_000), Math.max(0, deadline - Date.now()));
  if (graceMs === 0) return completion();
  try {
    await delay(graceMs, signal);
  } catch (cause: unknown) {
    if (completion()) return completion();
    throw cause;
  }
  return completion();
}

function stateFromStatus(data: RpcData, runId: string): string {
  const snapshot = data.asyncSnapshot;
  if (snapshot !== undefined) {
    if (!isRecord(snapshot) || snapshot.kind !== "pi-subagents.async-status-snapshot" || snapshot.version !== 1 || !Array.isArray(snapshot.runs)) {
      throw new Error("Invalid pi-subagents status reply: data.asyncSnapshot is invalid.");
    }
    const run = snapshot.runs.find((candidate) => isRecord(candidate) && candidate.id === runId);
    if (!run || typeof run.state !== "string") {
      throw new Error(`Invalid pi-subagents status reply: asyncSnapshot has no state for run ${runId}.`);
    }
    const state = normalizeState(run.state);
    if (!RUN_STATES.has(state)) throw new Error(`Invalid pi-subagents status reply: unknown asyncSnapshot state "${run.state}".`);
    return state;
  }
  const fallback = typeof data.text === "string" ? data.text.match(/(?:^|\n)\s*State:\s*(complete|completed|failed|paused|stopped|rejected)\b/i)?.[1] : undefined;
  if (!fallback) throw new Error("Invalid pi-subagents status reply: data.asyncSnapshot is required.");
  return normalizeState(fallback);
}

function completionFromEvent(raw: unknown, runId: string): Completion | undefined {
  if (!isRecord(raw) || raw.runId !== runId || typeof raw.state !== "string") return undefined;
  const state = normalizeState(raw.state);
  if (!TERMINAL_STATES.has(state)) return undefined;
  const payload: Record<string, unknown> = { runId, state };
  if (Array.isArray(raw.results)) payload.results = raw.results.slice(0, 20);
  if (typeof raw.output === "string") payload.output = raw.output.slice(0, MAX_COMPLETION_OUTPUT);
  return { state, payload };
}

function normalizeState(state: string): string {
  return state === "completed" ? "complete" : state;
}

function isUnknownAgentFailure(state: string, payload: unknown): boolean {
  return ["failed", "rejected"].includes(state) && /unknown agent|agent.*not.*regist|no such agent|invalid agent/i.test(JSON.stringify(payload));
}

async function interruptThenStopOwnedRun(pi: ExtensionAPI, runId: string): Promise<void> {
  try {
    const interrupt = await rpcCall(pi, "interrupt", { id: runId }, { timeoutMs: 5_000 });
    if (interrupt.success) return;
  } catch { /* stop is the fallback for unsupported or failed interrupts */ }
  try { await rpcCall(pi, "stop", { id: runId }, { timeoutMs: 5_000 }); } catch { /* best-effort cleanup for an owned run */ }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => { signal?.removeEventListener("abort", abort); resolveDelay(); };
    const abort = () => { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort); rejectDelay(abortError()); };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(done, ms);
  });
}
function abortError(): Error { const error = new Error("Operation aborted"); error.name = "AbortError"; return error; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function runIdFrom(reply: RpcReply): string {
  if (!reply.success) throw agentUnavailableError(new Error(`agent spawn failed: ${JSON.stringify(reply.error)}`));
  if (typeof reply.data.text !== "string") throw new Error("Invalid pi-subagents spawn reply: data.text is required.");
  const runId = reply.data.details?.runId ?? reply.data.details?.id;
  if (typeof runId !== "string" || !runId) throw new Error(`Invalid pi-subagents spawn reply: data.details.runId is required.`);
  return runId;
}

/** Surface actionable guidance when installed package agents are unavailable. */
export function agentUnavailableError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/unknown agent|agent.*not.*regist|no such agent|invalid agent|timed out|did not reach a terminal state/i.test(msg)) return new Error(`The pi-rpi agents could not run (${msg}). Install pi-subagents separately with pi install npm:pi-subagents, confirm pi-rpi is installed with pi list, then retry.`);
  return err instanceof Error ? err : new Error(msg);
}

export async function startResearch(pi: ExtensionAPI, nodes: ResearchNode[], tasks: string[], cwd: string, options: RunOptions = {}): Promise<RunReceipt> {
  if (nodes.length < 2) throw new Error("Research fanout needs at least 2 nodes");
  if (nodes.length > 6) throw new Error("Research fanout caps at 6 nodes");
  if (nodes.length !== tasks.length) throw new Error("nodes and tasks length mismatch");
  const items = nodes.map((agent, index) => `{ key: "n${index}", agent: ${JSON.stringify(agent)}, task: ${JSON.stringify(tasks[index] ?? "")}, context: "fresh", cwd: ${JSON.stringify(cwd)} }`).join(",\n        ");
  const spawn = await rpcCall(pi, "spawn", { workflowScript: `return runs.all([\n        ${items}\n      ])`, context: "fresh" }, options);
  const runId = runIdFrom(spawn);
  await reportSpawnedRun(pi, runId, options);
  const completed = await waitForCompletion(pi, runId, options);
  return { runId, ...completed };
}

export async function implementPhase(pi: ExtensionAPI, agent: "artifact-implementer" | "artifact-outline-implementer", phaseTask: string, cwd: string, options: ImplementationPhaseOptions = {}): Promise<RunReceipt> {
  const spawn = await rpcCall(pi, "spawn", { workflowScript: `return runs.run("main", { agent: ${JSON.stringify(agent)}, task: ${JSON.stringify(phaseTask)}, context: "fresh", cwd: ${JSON.stringify(cwd)} })`, context: "fresh" }, options);
  const runId = runIdFrom(spawn);
  await reportSpawnedRun(pi, runId, options);
  const timeoutMs = options.timeoutMs ?? 900_000;
  try {
    return { runId, ...(await waitForCompletion(pi, runId, { ...options, timeoutMs })) };
  } catch (cause: unknown) {
    if (!isTimeoutError(cause)) throw cause;
    throw implementationPhaseTimeoutError(options.phaseId, runId, timeoutMs);
  }
}

function isTimeoutError(cause: unknown): boolean {
  return /timed out|did not reach a terminal state/i.test(cause instanceof Error ? cause.message : String(cause));
}

function implementationPhaseTimeoutError(phaseId: string | undefined, runId: string | undefined, timeoutMs: number): Error {
  const identifiers = [phaseId && `phase ${phaseId}`, runId && `run ${runId}`].filter(Boolean).join(", ");
  return new Error(`The implementation phase timed out after ${timeoutMs}ms${identifiers ? ` (${identifiers})` : ""}.`);
}

export async function reviewImplementation(pi: ExtensionAPI, task: string, cwd: string, options: RunOptions = {}): Promise<RunReceipt> {
  const spawn = await rpcCall(pi, "spawn", { workflowScript: `return runs.run("main", { agent: "artifact-implementation-reviewer", task: ${JSON.stringify(task)}, context: "fresh", cwd: ${JSON.stringify(cwd)} })`, context: "fresh" }, options);
  const runId = runIdFrom(spawn);
  await reportSpawnedRun(pi, runId, options);
  return { runId, ...(await waitForCompletion(pi, runId, options)) };
}

async function reportSpawnedRun(pi: ExtensionAPI, runId: string, options: RunOptions): Promise<void> {
  try {
    await options.onSpawn?.(runId);
    await options.onProgress?.({ runId, state: "queued", pollCount: 0 });
  } catch (cause: unknown) {
    await interruptThenStopOwnedRun(pi, runId);
    throw cause;
  }
}
