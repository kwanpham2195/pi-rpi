/** Launch adapters for pi-subagents RPC. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ResearchNode =
  | "artifact-locator"
  | "artifact-analyzer"
  | "artifact-pattern-finder"
  | "artifact-web-researcher";

/** Lifecycle states reported by the pi-subagents async runtime. */
export type RunState = "queued" | "running" | "complete" | "failed" | "partial" | "paused" | "stopped" | "rejected";

/** Activity fields projected by a child run when the installed runtime provides them. */
export interface RunActivity {
  currentTool?: string;
  turnCount?: number;
  toolCount?: number;
}

/** Current state and useful activity for a spawned child run. */
export interface RunProgress {
  runId: string;
  state: RunState;
  pollCount: number;
  activity?: RunActivity;
}

/** Settled evidence returned by a pi-subagents run. */
export interface RunReceipt {
  runId: string;
  state: RunState;
  payload: unknown;
}

/** Timing, cancellation, and progress hooks for a child-run adapter. */
export interface RunOptions {
  signal?: AbortSignal;
  /** Deadline for one RPC request/reply exchange. */
  rpcTimeoutMs?: number;
  /** Runtime-owned child or workflow deadline. */
  runTimeoutMs?: number;
  /** Window for a terminal status to receive its richer completion event. */
  completionGraceMs?: number;
  /** Test and integration tuning; production polling defaults to two seconds. */
  pollIntervalMs?: number;
  onSpawn?: (runId: string) => Promise<void>;
  onProgress?: (progress: RunProgress) => Promise<void> | void;
}

/** Options specific to one implementation phase, including an optional child model. */
export interface ImplementationPhaseOptions extends RunOptions {
  phaseId?: string;
  model?: string;
}

type RpcData = { text?: string; details?: Record<string, unknown>; isError?: boolean; [key: string]: unknown };
type RpcReply =
  | { version: 1; requestId: string; method?: string; success: true; data: RpcData }
  | { version: 1; requestId: string; method?: string; success: false; error: { code: string; message: string } };

type ParsedRunStatus = Omit<RunProgress, "pollCount">;
type Completion = { state: RunState; payload: unknown };
type CleanupResult = { warning?: string };

const DEFAULT_RPC_TIMEOUT_MS = 20_000;
const DEFAULT_RESEARCH_TIMEOUT_MS = 600_000;
const DEFAULT_IMPLEMENTATION_TIMEOUT_MS = 1_200_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_COMPLETION_GRACE_MS = 2_000;
const CLEANUP_RPC_TIMEOUT_MS = 1_000;
const CLEANUP_RECONCILIATION_MS = 5_000;
const CLEANUP_POLL_INTERVAL_MS = 100;
const MAX_COMPLETION_OUTPUT = 12_000;
const MAX_ACTIVITY_TEXT = 160;
const MAX_ACTIVITY_COUNT = 1_000_000;
const REQUIRED_RPC_METHODS = ["spawn", "status", "interrupt", "stop"] as const;
const RUN_STATES: ReadonlySet<RunState> = new Set([
  "queued",
  "running",
  "complete",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
]);
const TERMINAL_STATES: ReadonlySet<RunState> = new Set([
  "complete",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
]);

/** Call pi-subagents RPC and parse its public envelope before use. */
export function rpcCall(
  pi: ExtensionAPI,
  method: string,
  params: Record<string, unknown>,
  options: RunOptions = {},
): Promise<RpcReply> {
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
    const finish = (action: () => void) => {
      if (!settled) {
        settled = true;
        cleanup();
        action();
      }
    };
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
    timer = setTimeout(
      () => finish(() => rejectPromise(new Error(`RPC ${method} timed out`))),
      options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
    );
    try {
      pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params });
    } catch (cause: unknown) {
      finish(() => rejectPromise(cause));
    }
  });
}

/** Confirm the installed RPC bridge exposes the lifecycle methods required by this adapter. */
export async function assertSubagentsRpcAvailable(pi: ExtensionAPI, options: RunOptions = {}): Promise<void> {
  let ping: RpcReply;
  try {
    ping = await rpcCall(pi, "ping", {}, options);
  } catch (cause: unknown) {
    if (options.signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) throw cause;
    throw subagentsRpcUnavailableError(`pi-subagents RPC ping failed: ${errorMessage(cause)}`);
  }
  if (!ping.success) {
    throw subagentsRpcUnavailableError(`pi-subagents RPC ping failed: ${ping.error.message}`);
  }
  if (ping.data.version !== 1) {
    throw subagentsRpcUnavailableError(
      `pi-subagents RPC ping returned unsupported protocol version ${String(ping.data.version)}; expected 1`,
    );
  }
  const methods = ping.data.methods;
  if (!Array.isArray(methods) || methods.some((method) => typeof method !== "string")) {
    throw subagentsRpcUnavailableError("pi-subagents RPC ping did not advertise its methods");
  }
  const missing = REQUIRED_RPC_METHODS.filter((method) => !methods.includes(method));
  if (missing.length > 0) {
    throw subagentsRpcUnavailableError(`pi-subagents RPC ping is missing required methods: ${missing.join(", ")}`);
  }
}

function parseRpcReply(raw: unknown, expectedRequestId: string): RpcReply {
  if (!isRecord(raw) || raw.version !== 1 || raw.requestId !== expectedRequestId || typeof raw.success !== "boolean") {
    throw new Error("Invalid pi-subagents RPC reply envelope.");
  }
  if (!raw.success) {
    if (!isRecord(raw.error) || typeof raw.error.code !== "string" || typeof raw.error.message !== "string") {
      throw new Error("Invalid pi-subagents RPC error reply.");
    }
    return {
      version: 1,
      requestId: expectedRequestId,
      ...(typeof raw.method === "string" ? { method: raw.method } : {}),
      success: false,
      error: { code: raw.error.code, message: raw.error.message },
    };
  }
  if (
    !isRecord(raw.data) ||
    (raw.data.text !== undefined && typeof raw.data.text !== "string") ||
    (raw.data.details !== undefined && !isRecord(raw.data.details))
  ) {
    throw new Error("Invalid pi-subagents RPC success reply.");
  }
  return {
    version: 1,
    requestId: expectedRequestId,
    ...(typeof raw.method === "string" ? { method: raw.method } : {}),
    success: true,
    data: raw.data as RpcData,
  };
}

async function waitForCompletion(
  pi: ExtensionAPI,
  runId: string,
  deadline: number,
  options: RunOptions,
): Promise<Completion> {
  const runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RESEARCH_TIMEOUT_MS;
  const waitController = new AbortController();
  let callerCancelled = options.signal?.aborted ?? false;
  let completion: Completion | undefined;
  let pollCount = 0;
  const abortForCaller = () => {
    callerCancelled = true;
    waitController.abort();
  };
  const unsubscribe = pi.events.on("subagent:async-complete", (raw: unknown) => {
    const parsed = completionFromEvent(raw, runId);
    if (!parsed) return;
    completion = parsed;
    waitController.abort();
  });
  options.signal?.addEventListener("abort", abortForCaller, { once: true });
  if (callerCancelled) waitController.abort();
  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw runDeadlineError(runId, runTimeoutMs);
      const pollDelayMs = Math.min(Math.max(0, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS), remainingMs);
      await delay(pollDelayMs, waitController.signal);
      if (completion) return completion;
      const statusRemainingMs = deadline - Date.now();
      if (statusRemainingMs <= 0) throw runDeadlineError(runId, runTimeoutMs);
      let status: RpcReply;
      try {
        status = await rpcCall(
          pi,
          "status",
          { id: runId },
          {
            ...options,
            signal: waitController.signal,
            rpcTimeoutMs: Math.min(options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS, Math.max(1, statusRemainingMs)),
          },
        );
      } catch (cause: unknown) {
        if (completion) return completion;
        if (!callerCancelled && Date.now() >= deadline) throw runDeadlineError(runId, runTimeoutMs);
        throw cause;
      }
      if (completion) return completion;
      if (!status.success) throw new Error(`child status failed: ${status.error.message}`);
      const parsed = parseRunStatus(status.data, runId);
      pollCount += 1;
      if (!TERMINAL_STATES.has(parsed.state)) {
        await options.onProgress?.({ runId, state: parsed.state, pollCount, ...optionalProgressFields(parsed) });
      }
      if (TERMINAL_STATES.has(parsed.state)) {
        if (Date.now() >= deadline) throw runDeadlineError(runId, runTimeoutMs);
        const eventCompletion = await waitForCompletionEventGrace(() => completion, waitController.signal, options);
        if (eventCompletion) return eventCompletion;
        const evidence = actionableAgentFailureEvidence(parsed.state, status.data);
        if (evidence) {
          throw agentUnavailableError(new Error(`child run ${runId} ended ${parsed.state}: ${evidence}`));
        }
        return { state: parsed.state, payload: status.data };
      }
    }
  } catch (cause: unknown) {
    if (completion) return completion;
    const cleanup =
      callerCancelled || options.signal?.aborted ? await interruptOwnedRun(pi, runId) : await stopOwnedRun(pi, runId);
    throw addCleanupWarning(cause, cleanup.warning);
  } finally {
    unsubscribe();
    options.signal?.removeEventListener("abort", abortForCaller);
  }
}

async function waitForCompletionEventGrace(
  completion: () => Completion | undefined,
  signal: AbortSignal,
  options: RunOptions,
): Promise<Completion | undefined> {
  if (completion()) return completion();
  const graceMs = Math.max(0, options.completionGraceMs ?? DEFAULT_COMPLETION_GRACE_MS);
  if (graceMs === 0) return completion();
  try {
    await delay(graceMs, signal);
  } catch (cause: unknown) {
    if (completion()) return completion();
    throw cause;
  }
  return completion();
}

function parseRunStatus(data: RpcData, runId: string): ParsedRunStatus {
  const snapshot = data.asyncSnapshot;
  if (snapshot !== undefined) {
    if (
      !isRecord(snapshot) ||
      snapshot.kind !== "pi-subagents.async-status-snapshot" ||
      snapshot.version !== 1 ||
      !Array.isArray(snapshot.runs)
    ) {
      throw new Error("Invalid pi-subagents status reply: data.asyncSnapshot is invalid.");
    }
    const run = snapshot.runs.find((candidate) => isRecord(candidate) && candidate.id === runId);
    if (isRecord(run)) {
      const state = parseRunState(run.state);
      if (!state)
        throw new Error(`Invalid pi-subagents status reply: unknown asyncSnapshot state "${String(run.state)}".`);
      const activity = parseActiveRunActivity(run);
      return {
        runId,
        state,
        ...(activity ? { activity } : {}),
      };
    }
  }
  const fallback =
    typeof data.text === "string"
      ? data.text.match(
          /(?:^|\n)\s*State:\s*(queued|running|complete|completed|partial|failed|paused|stopped|rejected)\b/i,
        )?.[1]
      : undefined;
  const state = fallback ? parseRunState(fallback) : undefined;
  if (!state) {
    if (snapshot !== undefined)
      throw new Error(`Invalid pi-subagents status reply: asyncSnapshot has no state for run ${runId}.`);
    throw new Error("Invalid pi-subagents status reply: data.asyncSnapshot is required.");
  }
  return { runId, state };
}

function completionFromEvent(raw: unknown, runId: string): Completion | undefined {
  if (!isRecord(raw) || raw.runId !== runId || typeof raw.state !== "string") return undefined;
  const state = parseRunState(raw.state);
  if (!state || !TERMINAL_STATES.has(state)) return undefined;
  const payload: Record<string, unknown> = { runId, state };
  if (Array.isArray(raw.results)) payload.results = raw.results.slice(0, 20);
  if (typeof raw.output === "string") payload.output = raw.output.slice(0, MAX_COMPLETION_OUTPUT);
  return { state, payload };
}

function parseRunState(state: unknown): RunState | undefined {
  if (typeof state !== "string") return undefined;
  const normalized = state === "completed" ? "complete" : state;
  if (!RUN_STATES.has(normalized as RunState)) return undefined;
  // SAFETY: RUN_STATES establishes that normalized is one of the public lifecycle states.
  return normalized as RunState;
}

function parseRunActivity(run: Record<string, unknown>): RunActivity | undefined {
  const source = isRecord(run.activity) ? run.activity : run;
  const currentTool = parseActivityText(source.currentTool);
  const turnCount = parseActivityCount(source.turnCount);
  const toolCount = parseActivityCount(source.toolCount);
  if (currentTool === undefined && turnCount === undefined && toolCount === undefined) return undefined;
  return {
    ...(currentTool !== undefined ? { currentTool } : {}),
    ...(turnCount !== undefined ? { turnCount } : {}),
    ...(toolCount !== undefined ? { toolCount } : {}),
  };
}

function parseActiveRunActivity(run: Record<string, unknown>): RunActivity | undefined {
  const activeChild = activeSnapshotChild(run.children);
  if (activeChild) return parseActiveRunActivity(activeChild) ?? parseRunActivity(activeChild) ?? parseRunActivity(run);
  return parseRunActivity(run);
}

function activeSnapshotChild(children: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(children)) return undefined;
  const records = children.filter(isRecord);
  const active =
    records.find((child) => child.state === "running") ??
    records.find((child) => child.state === "queued") ??
    records.find(
      (child) => typeof child.state === "string" && !TERMINAL_STATES.has(parseRunState(child.state) ?? "failed"),
    );
  return active;
}

function parseActivityText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = value.replace(/[\s\x00-\x1f\x7f-\x9f]+/g, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, MAX_ACTIVITY_TEXT) : undefined;
}

function parseActivityCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, MAX_ACTIVITY_COUNT)
    : undefined;
}

function optionalProgressFields(progress: ParsedRunStatus): Omit<RunProgress, "runId" | "state" | "pollCount"> {
  return {
    ...(progress.activity !== undefined ? { activity: progress.activity } : {}),
  };
}

function actionableAgentFailureEvidence(state: RunState, payload: RpcData): string | undefined {
  if (!["failed", "rejected"].includes(state)) return undefined;
  const pattern = /unknown agent|agent.*not.*regist|no such agent|invalid agent|requested unavailable child tools/i;
  const serialized = JSON.stringify(payload);
  const text = typeof payload.text === "string" ? payload.text : "";
  const source = pattern.test(text) ? text : serialized;
  const diagnosticIndex = source.search(pattern);
  if (diagnosticIndex < 0) return undefined;
  const start = Math.max(0, diagnosticIndex - 100);
  return source.slice(start, start + 1_200);
}

async function stopOwnedRun(pi: ExtensionAPI, runId: string): Promise<CleanupResult> {
  let requestWarning: string | undefined;
  try {
    const stop = await rpcCall(pi, "stop", { id: runId }, { rpcTimeoutMs: CLEANUP_RPC_TIMEOUT_MS });
    if (!stop.success) requestWarning = `stop failed: ${stop.error.message}`;
  } catch (cause: unknown) {
    requestWarning = `stop failed: ${errorMessage(cause)}`;
  }
  const reconciliation = await reconcileOwnedRun(pi, runId);
  if (reconciliation.state !== undefined) return {};
  return {
    warning:
      [requestWarning, reconciliation.warning].filter((value): value is string => value !== undefined).join("; ") ||
      `run ${runId} did not reach a terminal state after stop`,
  };
}

async function interruptOwnedRun(pi: ExtensionAPI, runId: string): Promise<CleanupResult> {
  try {
    const interrupt = await rpcCall(pi, "interrupt", { id: runId }, { rpcTimeoutMs: CLEANUP_RPC_TIMEOUT_MS });
    if (interrupt.success) {
      const reconciliation = await reconcileOwnedRun(pi, runId);
      if (reconciliation.state !== undefined) return {};
      return { warning: reconciliation.warning ?? `run ${runId} did not reach a terminal state after interrupt` };
    }
  } catch {
    // Interrupt is a resumable best effort. Stop the owned run if it is unsupported or fails.
  }
  return stopOwnedRun(pi, runId);
}

async function reconcileOwnedRun(pi: ExtensionAPI, runId: string): Promise<{ state?: RunState; warning?: string }> {
  const deadline = Date.now() + CLEANUP_RECONCILIATION_MS;
  let lastWarning: string | undefined;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    try {
      const status = await rpcCall(
        pi,
        "status",
        { id: runId },
        { rpcTimeoutMs: Math.min(CLEANUP_RPC_TIMEOUT_MS, remainingMs) },
      );
      if (!status.success) {
        lastWarning = `status reconciliation failed: ${status.error.message}`;
      } else {
        const parsed = parseRunStatus(status.data, runId);
        if (TERMINAL_STATES.has(parsed.state)) return { state: parsed.state };
        lastWarning = `run ${runId} is still ${parsed.state}`;
      }
    } catch (cause: unknown) {
      lastWarning = `status reconciliation failed: ${errorMessage(cause)}`;
    }
    const delayMs = Math.min(CLEANUP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    if (delayMs > 0) await delay(delayMs);
  }
  return { warning: lastWarning ?? `run ${runId} did not reach a terminal state after cleanup` };
}

function addCleanupWarning(cause: unknown, warning: string | undefined): Error {
  const original = toError(cause);
  if (!warning) return original;
  const error = new Error(`${original.message} Cleanup warning: ${warning}`);
  error.name = original.name;
  return error;
}

function runDeadlineError(runId: string, runTimeoutMs: number): Error {
  const error = new Error(`child run ${runId} did not reach a terminal state within ${runTimeoutMs}ms`);
  error.name = "RunTimeoutError";
  return error;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolveDelay();
    };
    const abort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      rejectDelay(abortError());
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(done, ms);
  });
}

function abortError(): Error {
  const error = new Error("Operation aborted");
  error.name = "AbortError";
  return error;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runIdFrom(reply: RpcReply): string {
  if (!reply.success) throw agentUnavailableError(new Error(`agent spawn failed: ${JSON.stringify(reply.error)}`));
  if (typeof reply.data.text !== "string") throw new Error("Invalid pi-subagents spawn reply: data.text is required.");
  const runId = reply.data.details?.runId ?? reply.data.details?.asyncId ?? reply.data.details?.id;
  if (typeof runId !== "string" || !runId)
    throw new Error("Invalid pi-subagents spawn reply: data.details.runId is required.");
  return runId;
}

function subagentsRpcUnavailableError(message: string): Error {
  return new Error(
    `The pi-rpi agents could not run (${message}). Install pi-subagents separately with pi install npm:pi-subagents, confirm pi-rpi is installed with pi list, then retry.`,
  );
}

/** Surface actionable guidance when installed package agents are unavailable. */
export function agentUnavailableError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/requested unavailable child tools/i.test(msg)) {
    return new Error(
      `The pi-rpi child is missing required extension tools (${msg}). The agent tools field is a strict allowlist; it does not load extension code. Load the provider in the child through subagentOnlyExtensions (child-only), extensions, or a path-like tools entry, and keep each registered tool name in tools.`,
    );
  }
  if (
    /unknown agent|agent.*not.*regist|no such agent|invalid agent|timed out|did not reach a terminal state/i.test(msg)
  ) {
    return new Error(
      `The pi-rpi agents could not run (${msg}). Install pi-subagents separately with pi install npm:pi-subagents, confirm pi-rpi is installed with pi list, then retry.`,
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/** Start the bounded research fanout as one pi-subagents workflow. */
export async function startResearch(
  pi: ExtensionAPI,
  nodes: ResearchNode[],
  tasks: string[],
  cwd: string,
  options: RunOptions = {},
): Promise<RunReceipt> {
  if (nodes.length < 2) throw new Error("Research fanout needs at least 2 nodes");
  if (nodes.length > 6) throw new Error("Research fanout caps at 6 nodes");
  if (nodes.length !== tasks.length) throw new Error("nodes and tasks length mismatch");
  const items = nodes
    .map(
      (agent, index) =>
        `{ key: "n${index}", agent: ${JSON.stringify(agent)}, task: ${JSON.stringify(tasks[index] ?? "")}, context: "fresh", cwd: ${JSON.stringify(cwd)} }`,
    )
    .join(",\n        ");
  const run = await launchOwnedRun(
    pi,
    (runTimeoutMs) => ({
      workflowScript: `return runs.all([\n        ${items}\n      ])`,
      context: "fresh",
      async: true,
      timeoutMs: runTimeoutMs,
    }),
    options,
    DEFAULT_RESEARCH_TIMEOUT_MS,
  );
  return { runId: run.runId, ...(await run.completion) };
}

/** Start one implementation child directly, without a workflow wrapper. */
export async function implementPhase(
  pi: ExtensionAPI,
  agent: "artifact-implementer" | "artifact-outline-implementer",
  phaseTask: string,
  cwd: string,
  options: ImplementationPhaseOptions = {},
): Promise<RunReceipt> {
  const run = await launchOwnedRun(
    pi,
    (runTimeoutMs) => ({
      agent,
      task: phaseTask,
      context: "fresh",
      cwd,
      async: true,
      timeoutMs: runTimeoutMs,
      ...(options.model !== undefined ? { model: options.model } : {}),
    }),
    options,
    DEFAULT_IMPLEMENTATION_TIMEOUT_MS,
  );
  try {
    return { runId: run.runId, ...(await run.completion) };
  } catch (cause: unknown) {
    if (!isRunTimeoutError(cause)) throw cause;
    const timeout = implementationPhaseTimeoutError(options.phaseId, run.runId, run.runTimeoutMs);
    const warningIndex = cause instanceof Error ? cause.message.indexOf(" Cleanup warning:") : -1;
    if (warningIndex >= 0 && cause instanceof Error) timeout.message += cause.message.slice(warningIndex);
    throw timeout;
  }
}

function isRunTimeoutError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "RunTimeoutError";
}

function implementationPhaseTimeoutError(
  phaseId: string | undefined,
  runId: string | undefined,
  runTimeoutMs: number,
): Error {
  const identifiers = [phaseId && `phase ${phaseId}`, runId && `run ${runId}`].filter(Boolean).join(", ");
  return new Error(
    `The implementation phase timed out after ${runTimeoutMs}ms${identifiers ? ` (${identifiers})` : ""}.`,
  );
}

/** Start the implementation reviewer directly, without a workflow wrapper. */
export async function reviewImplementation(
  pi: ExtensionAPI,
  task: string,
  cwd: string,
  options: RunOptions = {},
): Promise<RunReceipt> {
  const run = await launchOwnedRun(
    pi,
    (runTimeoutMs) => ({
      agent: "artifact-implementation-reviewer",
      task,
      context: "fresh",
      cwd,
      async: true,
      timeoutMs: runTimeoutMs,
    }),
    options,
    DEFAULT_RESEARCH_TIMEOUT_MS,
  );
  return { runId: run.runId, ...(await run.completion) };
}

type SpawnOutcome = "cancelled" | "timed-out";
type SpawnedRun = { runId: string; deadline: number };

type LaunchedRun = { runId: string; runTimeoutMs: number; completion: Promise<Completion> };

async function launchOwnedRun(
  pi: ExtensionAPI,
  spawnParams: (runTimeoutMs: number) => Record<string, unknown>,
  options: RunOptions,
  defaultRunTimeoutMs: number,
): Promise<LaunchedRun> {
  await assertSubagentsRpcAvailable(pi, options);
  const runTimeoutMs = options.runTimeoutMs ?? defaultRunTimeoutMs;
  const spawned = await spawnOwnedRun(pi, spawnParams(runTimeoutMs), options);
  await reportSpawnedRun(pi, spawned.runId, options);
  return {
    runId: spawned.runId,
    runTimeoutMs,
    completion: waitForCompletion(pi, spawned.runId, spawned.deadline, { ...options, runTimeoutMs }),
  };
}

async function spawnOwnedRun(
  pi: ExtensionAPI,
  params: Record<string, unknown>,
  options: RunOptions,
): Promise<SpawnedRun> {
  if (options.signal?.aborted) throw abortError();
  const rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  // This exchange retains exactly one bounded reply listener after its caller
  // settles. A late run id is cleaned up according to the captured primary cause.
  // After this window the runtime timeout sent in params is the only backstop.
  const runtimeTimeoutMs = typeof params.timeoutMs === "number" ? Math.max(0, params.timeoutMs) : 0;
  const emittedAt = Date.now();
  const deadline = emittedAt + runtimeTimeoutMs;
  const timeoutError = new Error("RPC spawn timed out");
  let primaryOutcome: SpawnOutcome | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation: ((cause: Error) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const abort = () => {
    if (primaryOutcome !== undefined) return;
    primaryOutcome = "cancelled";
    rejectCancellation?.(abortError());
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const primaryTimeout = new Promise<never>((_resolve, reject) => {
    if (runtimeTimeoutMs <= rpcTimeoutMs) return;
    timer = setTimeout(() => {
      if (primaryOutcome !== undefined) return;
      primaryOutcome = "timed-out";
      reject(timeoutError);
    }, rpcTimeoutMs);
  });
  // Promise.race installs rejection handlers for the late settlement. Its
  // continuation never rejects merely because primary ownership already ended.
  const settlement = rpcCall(pi, "spawn", params, {
    rpcTimeoutMs: Math.max(0, deadline - Date.now()),
  }).then(async (reply): Promise<SpawnedRun> => {
    const runId = runIdFrom(reply);
    if (primaryOutcome !== undefined) {
      const cleanup =
        primaryOutcome === "cancelled" ? await interruptOwnedRun(pi, runId) : await stopOwnedRun(pi, runId);
      if (cleanup.warning) timeoutError.message += ` Cleanup warning: ${cleanup.warning}`;
    }
    return { runId, deadline };
  });
  try {
    return await Promise.race([settlement, primaryTimeout, cancellation]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function reportSpawnedRun(pi: ExtensionAPI, runId: string, options: RunOptions): Promise<void> {
  try {
    await options.onSpawn?.(runId);
    await options.onProgress?.({ runId, state: "queued", pollCount: 0 });
  } catch (cause: unknown) {
    const cleanup = await stopOwnedRun(pi, runId);
    throw addCleanupWarning(cause, cleanup.warning);
  }
}
