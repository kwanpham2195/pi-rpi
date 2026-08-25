import { test } from "node:test";
import assert from "node:assert/strict";
import { rpcCall, startResearch } from "../../src/agent-runtime.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// A minimal fake ExtensionAPI EventBus to let startResearch run without pi.
function fakePi(): { pi: ExtensionAPI; captured: Array<{ method: string; params: unknown }> } {
  const captured: Array<{ method: string; params: Record<string, unknown> }> = [];
  let statusCalls = 0;
  const handlers = new Map<string, (data: unknown) => void>();
  const pi = {
    events: {
      on: (channel: string, h: (data: unknown) => void) => {
        handlers.set(channel, h);
        return () => handlers.delete(channel);
      },
      emit: (channel: string, data: unknown) => {
        const req = data as { method?: string; requestId?: string; params?: Record<string, unknown> };
        captured.push({ method: req.method ?? channel, params: req.params ?? {} });
        if (req.method === "spawn") {
          handlers.get(`subagents:rpc:v1:reply:${req.requestId}`)?.({
            version: 1, requestId: req.requestId, success: true,
            data: { text: "spawned", details: { runId: "wf-run-1" } },
          } as never);
        } else if (req.method === "status") {
          statusCalls += 1;
          handlers.get(`subagents:rpc:v1:reply:${req.requestId}`)?.({
            version: 1, requestId: req.requestId, success: true,
            data: { text: "complete output", details: { mode: "status", results: [] }, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "wf-run-1", state: "complete" }] } },
          } as never);
        }
      },
    },
  } as unknown as ExtensionAPI;
  return { pi, captured };
}

test("startResearch throws below 2 or above 6 nodes", async () => {
  const { pi } = fakePi();
  await assert.rejects(
    startResearch(pi, ["artifact-locator"], ["a"], "/tmp"),
    /at least 2 nodes/,
  );
  await assert.rejects(
    startResearch(
      pi,
      ["artifact-locator", "artifact-analyzer", "artifact-pattern-finder", "artifact-web-researcher", "artifact-locator", "artifact-analyzer", "artifact-pattern-finder"],
      ["a", "b", "c", "d", "e", "f", "g"],
      "/tmp",
    ),
    /caps at 6 nodes/,
  );
});

test("startResearch requires node/task length match", async () => {
  const { pi } = fakePi();
  await assert.rejects(
    startResearch(pi, ["artifact-locator", "artifact-analyzer"], ["only one"], "/tmp"),
    /length mismatch/,
  );
});

test("startResearch emits a runs.all spawn and falls back to terminal status after the grace period", async () => {
  const { pi, captured } = fakePi();
  const receipt = await startResearch(
    pi,
    ["artifact-locator", "artifact-analyzer"],
    ["find files", "analyze files"],
    "/tmp/x",
    { timeoutMs: 100, pollIntervalMs: 1, completionGraceMs: 5 },
  );
  assert.equal(receipt.runId, "wf-run-1");
  assert.equal(receipt.state, "complete");
  assert.deepEqual(receipt.payload, { text: "complete output", details: { mode: "status", results: [] }, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "wf-run-1", state: "complete" }] } });
  const spawn = captured.find((c) => c.method === "spawn");
  assert.ok(spawn);
  const script = String((spawn?.params as { workflowScript?: string })?.workflowScript ?? "");
  assert.match(script, /runs\.all/);
  assert.match(script, /artifact-locator/);
  assert.match(script, /artifact-analyzer/);
  assert.match(script, /"n0"/);
  assert.match(script, /"n1"/);
});

test("startResearch records spawn before onSpawn and polls only after the receipt callback", async () => {
  const events: string[] = [];
  const handlers = new Map<string, (data: unknown) => void>();
  const pi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel); },
      emit: (_channel: string, data: { method: string; requestId: string }) => {
        events.push(data.method);
        if (data.method === "spawn") {
          handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ version: 1, requestId: data.requestId, success: true, data: { text: "spawn", details: { runId: "ordered-run" } } });
        }
        if (data.method === "status") {
          handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ version: 1, requestId: data.requestId, success: true, data: { text: "done", details: { mode: "status", results: [] }, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "ordered-run", state: "complete" }] } } });
        }
      },
    },
  } as unknown as ExtensionAPI;
  await startResearch(pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
    timeoutMs: 25,
    onSpawn: async (runId) => { assert.equal(runId, "ordered-run"); events.push("onSpawn"); },
  });
  assert.deepEqual(events, ["spawn", "onSpawn", "status"]);
});

test("startResearch interrupts then stops the owned run when onSpawn rejects", async () => {
  const methods: string[] = [];
  const handlers = new Map<string, (data: unknown) => void>();
  const pi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel); },
      emit: (_channel: string, data: { method: string; requestId: string }) => {
        methods.push(data.method);
        const reply = data.method === "spawn"
          ? { version: 1, requestId: data.requestId, success: true, data: { text: "spawn", details: { runId: "stop-run" } } }
          : data.method === "interrupt"
            ? { version: 1, requestId: data.requestId, success: false, error: { code: "invalid_state", message: "workflow root is running" } }
            : { version: 1, requestId: data.requestId, success: true, data: { details: { state: "stopped" } } };
        handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.(reply);
      },
    },
  } as unknown as ExtensionAPI;
  await assert.rejects(
    startResearch(pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
      onSpawn: async () => { throw new Error("receipt failed"); },
      timeoutMs: 25,
    }),
    /receipt failed/,
  );
  assert.deepEqual(methods, ["spawn", "interrupt", "stop"]);
});

test("rpcCall rejects invalid synchronous replies and clears its timeout after a synchronous success", async () => {
  const invalidHandlers = new Map<string, (data: unknown) => void>();
  const invalidPi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => { invalidHandlers.set(channel, handler); return () => invalidHandlers.delete(channel); },
      emit: (_channel: string, data: { requestId: string }) => {
        queueMicrotask(() => invalidHandlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ invalid: true }));
      },
    },
  } as unknown as ExtensionAPI;
  await assert.rejects(rpcCall(invalidPi, "status", {}, { timeoutMs: 25 }), /Invalid pi-subagents RPC reply envelope/);

  const successHandlers = new Map<string, (data: unknown) => void>();
  let unsubscribeCalls = 0;
  const successPi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        successHandlers.set(channel, handler);
        return () => { unsubscribeCalls += 1; successHandlers.delete(channel); };
      },
      emit: (_channel: string, data: { requestId: string }) => {
        successHandlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ version: 1, requestId: data.requestId, success: true, data: { text: "ok" } });
      },
    },
  } as unknown as ExtensionAPI;
  const started = performance.now();
  await rpcCall(successPi, "status", {}, { timeoutMs: 100 });
  assert.ok(performance.now() - started < 50);
  assert.equal(unsubscribeCalls, 1);
});

test("terminal status waits briefly for matching completion summaries", async () => {
  const methods: string[] = [];
  const handlers = new Map<string, (data: unknown) => void>();
  const pi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel); },
      emit: (_channel: string, data: { method: string; requestId: string }) => {
        methods.push(data.method);
        if (data.method === "spawn") {
          handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ version: 1, requestId: data.requestId, success: true, data: { text: "spawn", details: { runId: "event-run" } } });
          return;
        }
        if (data.method === "status") {
          handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({
            version: 1,
            requestId: data.requestId,
            success: true,
            data: { text: "terminal status text", details: { mode: "status", results: [] }, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "event-run", state: "complete" }] } },
          });
          setTimeout(() => handlers.get("subagent:async-complete")?.({ runId: "event-run", state: "complete", results: [{ agent: "artifact-locator", summary: "found files" }, { agent: "artifact-analyzer", summary: "analyzed files" }], output: "child output" }), 5);
        }
      },
    },
  } as unknown as ExtensionAPI;
  const started = performance.now();
  const receipt = await startResearch(pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", { timeoutMs: 100, pollIntervalMs: 1, completionGraceMs: 50 });
  assert.ok(performance.now() - started < 75);
  assert.equal(receipt.state, "complete");
  assert.deepEqual(receipt.payload, {
    runId: "event-run",
    state: "complete",
    results: [{ agent: "artifact-locator", summary: "found files" }, { agent: "artifact-analyzer", summary: "analyzed files" }],
    output: "child output",
  });
  assert.deepEqual(methods, ["spawn", "status"]);
});

test("startResearch interrupts an owned run after caller cancellation", async () => {
  const methods: string[] = [];
  const handlers = new Map<string, (data: unknown) => void>();
  const controller = new AbortController();
  const pi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel); },
      emit: (_channel: string, data: { method: string; requestId: string }) => {
        methods.push(data.method);
        if (data.method === "spawn") {
          handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ version: 1, requestId: data.requestId, success: true, data: { text: "spawn", details: { runId: "cancel-run" } } });
          queueMicrotask(() => controller.abort());
          return;
        }
        handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ version: 1, requestId: data.requestId, success: true, data: { details: { state: "paused" } } });
      },
    },
  } as unknown as ExtensionAPI;
  await assert.rejects(
    startResearch(pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", { signal: controller.signal }),
    /Operation aborted/,
  );
  assert.deepEqual(methods, ["spawn", "interrupt"]);
});
