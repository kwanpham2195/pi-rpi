import { test } from "node:test";
import assert from "node:assert/strict";
import { implementPhase, reviewImplementation, rpcCall, startResearch } from "../../src/agent-runtime.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PI_SUBAGENTS_RPC_V1_FIXTURE } from "../fixtures/pi-subagents-rpc-v1.ts";

type RpcRequest = { method: string; requestId: string; params: Record<string, unknown> };
type RpcReply = (response: unknown) => void;
type StatusNode = {
  state: string;
  activity?: Record<string, unknown>;
  children?: Array<Record<string, unknown>>;
};

type BridgeConfig = {
  runIds?: string[];
  statuses?: StatusNode[];
  pingData?: Record<string, unknown>;
  onRequest?: (request: RpcRequest, reply: RpcReply, bridge: FakeBridge) => void;
};

class FakeBridge {
  readonly captured: RpcRequest[] = [];
  readonly methods: string[] = [];
  readonly handlers = new Map<string, (data: unknown) => void>();
  private readonly runIds: string[];
  private readonly statuses: StatusNode[];
  private readonly pingData: Record<string, unknown>;
  private readonly onRequest?: BridgeConfig["onRequest"];
  private spawnCount = 0;
  private statusCount = 0;

  constructor(config: BridgeConfig = {}) {
    this.runIds = config.runIds ?? ["run-1"];
    this.statuses = config.statuses ?? [{ state: "complete" }];
    this.pingData = config.pingData ?? PI_SUBAGENTS_RPC_V1_FIXTURE.ping;
    this.onRequest = config.onRequest;
  }

  readonly pi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        this.handlers.set(channel, handler);
        return () => this.handlers.delete(channel);
      },
      emit: (_channel: string, raw: unknown) => {
        const request = raw as RpcRequest;
        this.captured.push(request);
        this.methods.push(request.method);
        const reply = (response: unknown) => this.handlers.get(`subagents:rpc:v1:reply:${request.requestId}`)?.(response);
        if (this.onRequest) {
          this.onRequest(request, reply, this);
          return;
        }
        if (request.method === "ping") {
          reply({ version: 1, requestId: request.requestId, success: true, data: this.pingData });
          return;
        }
        if (request.method === "spawn") {
          const runId = this.runIds[Math.min(this.spawnCount++, this.runIds.length - 1)] ?? "run-1";
          reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawned", details: { runId } } });
          return;
        }
        if (request.method === "status") {
          const status = this.statuses[Math.min(this.statusCount++, this.statuses.length - 1)] ?? { state: "running" };
          reply({
            version: 1,
            requestId: request.requestId,
            success: true,
            data: {
              text: status.state,
              asyncSnapshot: {
                kind: "pi-subagents.async-status-snapshot",
                version: 1,
                runs: [{ id: request.params.id, state: status.state, ...(status.activity ? { activity: status.activity } : {}), ...(status.children ? { children: status.children } : {}) }],
              },
            },
          });
          return;
        }
        reply({ version: 1, requestId: request.requestId, success: true, data: { text: request.method } });
      },
    },
  } as unknown as ExtensionAPI;

  emitCompletion(payload: Record<string, unknown>): void {
    this.handlers.get("subagent:async-complete")?.(payload);
  }

  statusIndex(): number {
    return this.statusCount;
  }
}

function statusBridge(statuses: StatusNode[], runIds?: string[]): FakeBridge {
  return new FakeBridge({ statuses, runIds });
}

function rpcFixtureBridge(): FakeBridge {
  const fixture = PI_SUBAGENTS_RPC_V1_FIXTURE;
  let state: string = fixture.status.asyncSnapshot.runs[0].state;
  return new FakeBridge({ onRequest: (request, reply) => {
    const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
    if (request.method === "ping") return respond(fixture.ping);
    if (request.method === "spawn") return respond(fixture.spawn);
    assert.equal(request.params.id, fixture.spawn.details.runId);
    if (request.method === "status") {
      return respond(state === "running" ? fixture.status : {
        ...fixture.status,
        asyncSnapshot: {
          ...fixture.status.asyncSnapshot,
          runs: fixture.status.asyncSnapshot.runs.map((run) => ({ ...run, state })),
        },
      });
    }
    if (request.method === "interrupt" || request.method === "stop") {
      const response = fixture[request.method];
      state = response.details.state;
      return respond(response);
    }
    assert.fail(`Unexpected fixture RPC method: ${request.method}`);
  } });
}

test("RPC v1 fixture supplies spawn, running progress, and completion with the default implementation timeout", async () => {
  const bridge = rpcFixtureBridge();
  const progress: unknown[] = [];
  const receipt = await implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    pollIntervalMs: 0,
    onProgress: (update) => {
      if (update.state !== "running") return;
      progress.push(update);
      bridge.emitCompletion(PI_SUBAGENTS_RPC_V1_FIXTURE.completion);
    },
  });

  assert.deepEqual(receipt, {
    runId: "fixture-run",
    state: "complete",
    payload: PI_SUBAGENTS_RPC_V1_FIXTURE.completion,
  });
  assert.deepEqual(progress, [{
    runId: "fixture-run", state: "running", pollCount: 1,
    activity: { currentTool: "bash", turnCount: 1, toolCount: 2 },
  }]);
  assert.deepEqual(PI_SUBAGENTS_RPC_V1_FIXTURE.status.asyncSnapshot, {
    kind: "pi-subagents.async-status-snapshot",
    version: 1,
    generatedAt: 1_788_739_200_000,
    caps: { maxRuns: 20, maxChildrenPerNode: 8, maxDepth: 3, maxStringLength: 160, maxSerializedBytes: 32 * 1024 },
    omitted: { runs: 0, children: 0, byteLimitExceeded: false },
    runs: [{ id: "fixture-run", kind: "subagent", label: "artifact-implementer", state: "running", activity: { currentTool: "bash", turnCount: 1, toolCount: 2 } }],
  });
  assert.equal(bridge.captured.find((request) => request.method === "spawn")?.params.timeoutMs, 1_200_000);
  assert.equal(bridge.handlers.size, 0);
});

test("RPC v1 interrupt fixture reconciles caller cancellation to paused", async () => {
  const bridge = rpcFixtureBridge();
  const controller = new AbortController();
  await assert.rejects(implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    signal: controller.signal,
    pollIntervalMs: 0,
    onProgress: (update) => { if (update.state === "running") controller.abort(); },
  }), { name: "AbortError", message: "Operation aborted" });

  assert.ok(bridge.captured.some((request) => request.method === "interrupt" && request.params.id === "fixture-run"));
  assert.equal(bridge.methods.includes("stop"), false);
  assert.equal(bridge.handlers.size, 0);
});

test("RPC v1 stop fixture reconciles an implementation deadline to stopped", async () => {
  const bridge = rpcFixtureBridge();
  await assert.rejects(implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    runTimeoutMs: 0,
  }), { message: "The implementation phase timed out after 0ms (run fixture-run)." });

  assert.ok(bridge.captured.some((request) => request.method === "stop" && request.params.id === "fixture-run"));
  assert.equal(bridge.methods.includes("interrupt"), false);
  assert.equal(bridge.handlers.size, 0);
});

test("ping precedes spawn and missing lifecycle capabilities fail before launch", async () => {
  const bridge = new FakeBridge({ pingData: { version: 1, methods: ["ping", "status", "spawn"] } });

  await assert.rejects(
    implementPhase(bridge.pi, "artifact-implementer", "Implement", "/tmp", { runTimeoutMs: 10 }),
    /missing required methods: interrupt, stop/,
  );
  assert.deepEqual(bridge.methods, ["ping"]);
});

test("startResearch rejects invalid fanout shapes before RPC launch", async () => {
  const cases = [
    {
      nodes: ["artifact-locator"],
      tasks: ["a"],
      error: /at least 2 nodes/,
    },
    {
      nodes: ["artifact-locator", "artifact-analyzer", "artifact-pattern-finder", "artifact-web-researcher", "artifact-locator", "artifact-analyzer", "artifact-pattern-finder"],
      tasks: ["a", "b", "c", "d", "e", "f", "g"],
      error: /caps at 6 nodes/,
    },
    {
      nodes: ["artifact-locator", "artifact-analyzer"],
      tasks: ["only one"],
      error: /length mismatch/,
    },
  ] as const;

  for (const { nodes, tasks, error } of cases) {
    const bridge = new FakeBridge();
    await assert.rejects(startResearch(bridge.pi, [...nodes], [...tasks], "/tmp"), error);
    assert.deepEqual(bridge.methods, []);
  }
});

test("startResearch persists the spawn receipt before the first status poll", async () => {
  const events: string[] = [];
  let receiptPersisted = false;
  const bridge = new FakeBridge({ onRequest: (request, reply) => {
    events.push(request.method);
    const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
    if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
    if (request.method === "spawn") return respond({ text: "spawned", details: { runId: "ordered-run" } });
    if (request.method === "status") {
      assert.equal(receiptPersisted, true);
      return respond({ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "ordered-run", state: "complete" }] } });
    }
    assert.fail(`Unexpected RPC method: ${request.method}`);
  } });

  await startResearch(bridge.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
    runTimeoutMs: 100,
    pollIntervalMs: 0,
    completionGraceMs: 0,
    onSpawn: async (runId) => {
      assert.equal(runId, "ordered-run");
      events.push("onSpawn:start");
      await new Promise<void>((resolve) => setImmediate(resolve));
      receiptPersisted = true;
      events.push("onSpawn:end");
    },
  });

  assert.deepEqual(events, ["ping", "spawn", "onSpawn:start", "onSpawn:end", "status"]);
});

test("startResearch keeps workflowScript and passes the runtime timeout at the workflow root", async () => {
  const bridge = statusBridge([{ state: "complete" }]);
  const receipt = await startResearch(
    bridge.pi,
    ["artifact-locator", "artifact-analyzer"],
    ["find files", "analyze files"],
    "/tmp/x",
    { runTimeoutMs: 100, pollIntervalMs: 1, completionGraceMs: 0 },
  );

  assert.equal(receipt.runId, "run-1");
  assert.equal(receipt.state, "complete");
  assert.deepEqual(bridge.methods, ["ping", "spawn", "status"]);
  const spawn = bridge.captured[1];
  assert.ok(spawn);
  assert.equal(spawn.method, "spawn");
  assert.equal(spawn.params.async, true);
  assert.equal(spawn.params.timeoutMs, 100);
  assert.match(String(spawn.params.workflowScript), /runs\.all/);
  assert.match(String(spawn.params.workflowScript), /artifact-locator/);
  assert.match(String(spawn.params.workflowScript), /artifact-analyzer/);
});

test("startResearch uses the default research timeout at the workflow root", async () => {
  const bridge = statusBridge([{ state: "complete" }]);

  await startResearch(
    bridge.pi,
    ["artifact-locator", "artifact-analyzer"],
    ["find files", "analyze files"],
    "/tmp/x",
    { pollIntervalMs: 1, completionGraceMs: 0 },
  );

  const spawn = bridge.captured[1];
  assert.ok(spawn);
  assert.equal(spawn.method, "spawn");
  assert.equal(spawn.params.timeoutMs, 600_000);
});

test("implementation and review use direct async child requests", async () => {
  const bridge = statusBridge([{ state: "complete" }, { state: "complete" }], ["implementation-run", "review-run"]);
  const implementation = await implementPhase(bridge.pi, "artifact-implementer", "authoritative task", "/tmp/project", {
    runTimeoutMs: 123,
    model: "provider/fast-model",
    pollIntervalMs: 1,
    completionGraceMs: 0,
  });
  const review = await reviewImplementation(bridge.pi, "review task", "/tmp/project", { pollIntervalMs: 1, completionGraceMs: 0 });

  assert.equal(implementation.runId, "implementation-run");
  assert.equal(review.runId, "review-run");
  const spawns = bridge.captured.filter((request) => request.method === "spawn");
  assert.equal(spawns.length, 2);
  assert.deepEqual(spawns[0]?.params, {
    agent: "artifact-implementer",
    task: "authoritative task",
    context: "fresh",
    cwd: "/tmp/project",
    async: true,
    timeoutMs: 123,
    model: "provider/fast-model",
  });
  assert.deepEqual(spawns[1]?.params, {
    agent: "artifact-implementation-reviewer",
    task: "review task",
    context: "fresh",
    cwd: "/tmp/project",
    async: true,
    timeoutMs: 600_000,
  });
  assert.equal("workflowScript" in (spawns[0]?.params ?? {}), false);
  assert.equal("workflowScript" in (spawns[1]?.params ?? {}), false);
});

test("rpcCall uses the independently configured RPC deadline", async () => {
  const bridge = new FakeBridge({ onRequest: (request, _reply) => {
    if (request.method === "ping") return;
  } });
  const started = performance.now();
  await assert.rejects(rpcCall(bridge.pi, "status", {}, { rpcTimeoutMs: 5 }), /RPC status timed out/);
  assert.ok(performance.now() - started < 100);
});

test("partial is terminal and is preserved from status snapshots", async () => {
  const bridge = statusBridge([{ state: "partial" }]);
  const receipt = await startResearch(bridge.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
    runTimeoutMs: 100,
    pollIntervalMs: 1,
    completionGraceMs: 0,
  });

  assert.equal(receipt.state, "partial");
  assert.equal((receipt.payload as { asyncSnapshot: { runs: Array<{ state: string }> } }).asyncSnapshot.runs[0]?.state, "partial");
});

test("partial completion events are preserved", async () => {
  const bridge = new FakeBridge();
  const receipt = await implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    runTimeoutMs: 100,
    pollIntervalMs: 1,
    completionGraceMs: 10,
    onSpawn: async () => { setTimeout(() => bridge.emitCompletion({ runId: "run-1", state: "partial", output: "settled evidence" }), 2); },
  });
  assert.equal(receipt.state, "partial");
  assert.deepEqual(receipt.payload, { runId: "run-1", state: "partial", output: "settled evidence" });
});

test("targeted status text supplies state when a valid bounded snapshot omits the owned run", async () => {
  let statusCount = 0;
  const bridge = new FakeBridge({ onRequest: (request, reply) => {
    const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
    if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
    if (request.method === "spawn") return respond({ text: "spawned", details: { runId: "owned-run" } });
    if (request.method === "status") {
      statusCount += 1;
      const state = statusCount === 1 ? "running" : "complete";
      return respond({
        text: `Agent: artifact-implementer\nState: ${state}`,
        asyncSnapshot: {
          kind: "pi-subagents.async-status-snapshot",
          version: 1,
          runs: [{ id: "another-run", state: "running" }],
        },
      });
    }
    assert.fail(`Unexpected cleanup RPC: ${request.method}`);
  } });

  const receipt = await implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    runTimeoutMs: 100,
    pollIntervalMs: 0,
    completionGraceMs: 0,
  });

  assert.equal(receipt.state, "complete");
  assert.equal(bridge.methods.includes("stop"), false);
});

for (const invalidStatus of [
  {
    name: "missing owned-run state in both snapshot and targeted text",
    data: {
      text: "Agent: artifact-implementer",
      asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "another-run", state: "running" }] },
    },
    error: /asyncSnapshot has no state for run owned-run/,
  },
  {
    name: "malformed snapshot even when targeted text has a state",
    data: {
      text: "State: running",
      asyncSnapshot: { kind: "wrong-kind", version: 1, runs: [] },
    },
    error: /data\.asyncSnapshot is invalid/,
  },
  {
    name: "invalid present owned-run state even when targeted text has a state",
    data: {
      text: "State: running",
      asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "owned-run", state: "mystery" }] },
    },
    error: /unknown asyncSnapshot state "mystery"/,
  },
] as const) {
  test(`targeted status rejects ${invalidStatus.name}`, async () => {
    let stopping = false;
    const bridge = new FakeBridge({ onRequest: (request, reply) => {
      const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
      if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
      if (request.method === "spawn") return respond({ text: "spawned", details: { runId: "owned-run" } });
      if (request.method === "stop") {
        stopping = true;
        return respond({ text: "stopped" });
      }
      if (request.method === "status" && stopping) {
        return respond({ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "owned-run", state: "stopped" }] } });
      }
      if (request.method === "status") return respond(invalidStatus.data);
      assert.fail(`Unexpected RPC method: ${request.method}`);
    } });

    await assert.rejects(implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
      runTimeoutMs: 100,
      pollIntervalMs: 0,
      completionGraceMs: 0,
    }), invalidStatus.error);
    assert.equal(bridge.methods.includes("stop"), true);
  });
}

test("missing child extension tools surface bounded provider-loading remediation", async () => {
  const diagnostic = [
    "Agent 'artifact-locator' requested unavailable child tools: fffind.",
    "The `tools` field is a strict allowlist; it does not load extension code.",
    "For extension tools, add the provider path to `subagentOnlyExtensions` (child-only), `extensions`, or as a path-like entry in `tools`, while keeping each registered tool name in `tools`.",
  ].join("\n");
  for (const failureData of [
    { text: "State: failed", details: { childToolDiagnostic: diagnostic } },
    { text: `${"unrelated output ".repeat(100)}${diagnostic}` },
  ]) {
    const bridge = new FakeBridge({ onRequest: (request, reply) => {
      const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
      if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
      if (request.method === "spawn") return respond({ text: "spawned", details: { runId: "missing-tool-run" } });
      if (request.method === "status") return respond({
        ...failureData,
        asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "missing-tool-run", state: "failed" }] },
      });
      assert.fail(`Unexpected RPC method: ${request.method}`);
    } });

    await assert.rejects(startResearch(bridge.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
      pollIntervalMs: 0,
      completionGraceMs: 0,
    }), (error: Error) => {
      assert.match(error.message, /requested unavailable child tools: fffind/);
      assert.match(error.message, /strict allowlist; it does not load extension code/);
      assert.match(error.message, /subagentOnlyExtensions.*extensions/s);
      assert.ok(error.message.length < 1_600);
      assert.doesNotMatch(error.message, /Install pi-subagents/);
      return true;
    });
  }
});

test("status activity is parsed and minimal older snapshots remain valid", async () => {
  const bridge = statusBridge([
    { state: "running", activity: { currentTool: "bash", turnCount: 12, toolCount: 24 } },
    { state: "complete" },
  ]);
  const progress: Array<{ state: string; pollCount: number; activity?: { currentTool?: string; turnCount?: number; toolCount?: number } }> = [];
  await startResearch(bridge.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
    runTimeoutMs: 100,
    pollIntervalMs: 1,
    completionGraceMs: 0,
    onProgress: (update) => { progress.push(update); },
  });
  assert.deepEqual(progress, [
    { runId: "run-1", state: "queued", pollCount: 0 },
    { runId: "run-1", state: "running", pollCount: 1, activity: { currentTool: "bash", turnCount: 12, toolCount: 24 } },
  ]);

  const minimal = statusBridge([{ state: "completed" }]);
  const receipt = await startResearch(minimal.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
    runTimeoutMs: 100,
    pollIntervalMs: 1,
    completionGraceMs: 0,
  });
  assert.equal(receipt.state, "complete");
});

test("research progress selects the active nested child and bounds its tool label", async () => {
  const nested = statusBridge([
    { state: "running", children: [{ id: "child", state: "running", activity: { currentTool: "x".repeat(400), turnCount: 3, toolCount: 4 } }] },
    { state: "complete" },
  ]);
  const progress: Array<{ activity?: { currentTool?: string; turnCount?: number; toolCount?: number } }> = [];
  await startResearch(nested.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
    runTimeoutMs: 100,
    pollIntervalMs: 1,
    completionGraceMs: 0,
    onProgress: (update) => { progress.push(update); },
  });
  assert.equal(progress[1]?.activity?.currentTool?.length, 160);
  assert.deepEqual(progress[1]?.activity, { currentTool: "x".repeat(160), turnCount: 3, toolCount: 4 });
});

test("an in-flight status RPC is bounded by the runtime deadline", async () => {
  let stopRequested = false;
  const bridge = new FakeBridge({
    onRequest: (request, reply) => {
      if (request.method === "ping") {
        reply({ version: 1, requestId: request.requestId, success: true, data: { version: 1, methods: ["ping", "status", "spawn", "interrupt", "stop"] } });
        return;
      }
      if (request.method === "spawn") {
        reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawned", details: { runId: "in-flight-status-run" } } });
        return;
      }
      if (request.method === "stop") {
        stopRequested = true;
        reply({ version: 1, requestId: request.requestId, success: true, data: { text: "stopped" } });
        return;
      }
      if (request.method === "status" && stopRequested) {
        reply({ version: 1, requestId: request.requestId, success: true, data: { asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "in-flight-status-run", state: "stopped" }] } } });
      }
    },
  });

  await assert.rejects(
    implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", { phaseId: "Phase 1: Test", runTimeoutMs: 10, pollIntervalMs: 0, completionGraceMs: 0 }),
    (error: Error) => {
      assert.match(error.message, /implementation phase timed out after 10ms/);
      assert.doesNotMatch(error.message, /RPC status timed out/);
      return true;
    },
  );
  assert.equal(bridge.methods.includes("stop"), true);
});

test("runtime timeout stops the owned run and reconciles a terminal stopped state", async () => {
  let stopRequested = false;
  const bridge = new FakeBridge({
    statuses: [{ state: "running" }, { state: "stopped" }],
    onRequest: (request, reply, current) => {
      if (request.method === "ping") {
        reply({ version: 1, requestId: request.requestId, success: true, data: { version: 1, methods: ["ping", "status", "spawn", "interrupt", "stop"] } });
        return;
      }
      if (request.method === "spawn") {
        reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawned", details: { runId: "timeout-run" } } });
        return;
      }
      if (request.method === "status") {
        const state = stopRequested ? "stopped" : "running";
        reply({ version: 1, requestId: request.requestId, success: true, data: { asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "timeout-run", state }] } } });
        return;
      }
      if (request.method === "stop") stopRequested = true;
      reply({ version: 1, requestId: request.requestId, success: true, data: { text: request.method } });
    },
  });

  await assert.rejects(
    implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", { phaseId: "phase-1", runTimeoutMs: 5, pollIntervalMs: 0, completionGraceMs: 0 }),
    (error: Error) => {
      assert.match(error.message, /implementation phase timed out after 5ms/);
      assert.match(error.message, /phase phase-1/);
      return true;
    },
  );
  assert.equal(bridge.methods.includes("interrupt"), false);
  assert.equal(bridge.methods.includes("stop"), true);
});

test("caller cancellation interrupts and reconciles without stopping when interrupt succeeds", async () => {
  const controller = new AbortController();
  const bridge = new FakeBridge({ statuses: [{ state: "paused" }], onRequest: (request, reply) => {
    if (request.method === "spawn") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawned", details: { runId: "cancel-run" } } });
      queueMicrotask(() => controller.abort());
      return;
    }
    if (request.method === "ping") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { version: 1, methods: ["ping", "status", "spawn", "interrupt", "stop"] } });
      return;
    }
    if (request.method === "status") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "cancel-run", state: "paused" }] } } });
      return;
    }
    reply({ version: 1, requestId: request.requestId, success: true, data: { text: request.method } });
  } });

  await assert.rejects(
    startResearch(bridge.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", { signal: controller.signal }),
    /Operation aborted/,
  );
  assert.equal(bridge.methods.includes("interrupt"), true);
  assert.equal(bridge.methods.includes("stop"), false);
});

test("failed caller interrupt falls back to stop", async () => {
  const controller = new AbortController();
  const bridge = new FakeBridge({ statuses: [{ state: "stopped" }], onRequest: (request, reply) => {
    if (request.method === "spawn") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { text: "spawned", details: { runId: "fallback-run" } } });
      queueMicrotask(() => controller.abort());
      return;
    }
    if (request.method === "ping") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { version: 1, methods: ["ping", "status", "spawn", "interrupt", "stop"] } });
      return;
    }
    if (request.method === "interrupt") {
      reply({ version: 1, requestId: request.requestId, success: false, error: { code: "unsupported", message: "interrupt unsupported" } });
      return;
    }
    if (request.method === "status") {
      reply({ version: 1, requestId: request.requestId, success: true, data: { asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "fallback-run", state: "stopped" }] } } });
      return;
    }
    reply({ version: 1, requestId: request.requestId, success: true, data: { text: request.method } });
  } });

  await assert.rejects(
    startResearch(bridge.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", { signal: controller.signal }),
    /Operation aborted/,
  );
  assert.deepEqual(bridge.methods.filter((method) => ["interrupt", "stop"].includes(method)), ["interrupt", "stop"]);
});

test("receipt persistence failure stops the owned run", async () => {
  const bridge = statusBridge([{ state: "stopped" }]);
  await assert.rejects(
    startResearch(bridge.pi, ["artifact-locator", "artifact-analyzer"], ["a", "b"], "/tmp", {
      onSpawn: async () => { throw new Error("receipt failed"); },
      runTimeoutMs: 100,
      completionGraceMs: 0,
    }),
    /receipt failed/,
  );
  assert.equal(bridge.methods.includes("stop"), true);
});

test("rpcCall rejects invalid replies and clears its timeout after success", async () => {
  const handlers = new Map<string, (data: unknown) => void>();
  const invalidPi = {
    events: {
      on: (channel: string, handler: (data: unknown) => void) => { handlers.set(channel, handler); return () => handlers.delete(channel); },
      emit: (_channel: string, data: { requestId: string }) => queueMicrotask(() => handlers.get(`subagents:rpc:v1:reply:${data.requestId}`)?.({ invalid: true })),
    },
  } as unknown as ExtensionAPI;
  await assert.rejects(rpcCall(invalidPi, "status", {}, { rpcTimeoutMs: 25 }), /Invalid pi-subagents RPC reply envelope/);

  const success = new FakeBridge();
  await rpcCall(success.pi, "ping", {}, { rpcTimeoutMs: 100 });
});

test("implementation settles a delayed spawn reply after abort and cleans up the owned run", async () => {
  const controller = new AbortController();
  let childState = "running";
  let releaseSpawn: (() => void) | undefined;
  let spawnEmitted: (() => void) | undefined;
  const emitted = new Promise<void>((resolve) => { spawnEmitted = resolve; });
  const bridge = new FakeBridge({ onRequest: (request, reply) => {
    const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
    if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
    if (request.method === "spawn") {
      releaseSpawn = () => respond({ text: "spawned", details: { runId: "delayed-run" } });
      spawnEmitted?.();
      return;
    }
    assert.equal(request.params.id, "delayed-run");
    if (request.method === "interrupt") childState = "paused";
    if (request.method === "status") return respond({ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "delayed-run", state: childState }] } });
    respond({ text: request.method });
  } });
  let settled = false;
  const result = implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    signal: controller.signal, rpcTimeoutMs: 1000, runTimeoutMs: 100,
  });
  const rejected = assert.rejects(result, { name: "AbortError", message: "Operation aborted" });
  result.then(() => { settled = true; }, () => { settled = true; });
  await emitted;
  controller.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const settledBeforeReply = settled;
  await rejected;
  assert.equal(bridge.handlers.size, 1);
  assert.ok(releaseSpawn);
  releaseSpawn();
  assert.equal(settledBeforeReply, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(childState, "paused");
  assert.deepEqual(bridge.methods, ["ping", "spawn", "interrupt", "status"]);
  assert.equal(bridge.handlers.size, 0);
});

test("implementation preserves pre-spawn cancellation and spawn RPC timeout classification", async () => {
  const controller = new AbortController();
  controller.abort();
  const beforeLaunch = new FakeBridge();
  await assert.rejects(implementPhase(beforeLaunch.pi, "artifact-implementer", "task", "/tmp", { signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(beforeLaunch.methods, []);

  const duringPing = new AbortController();
  const beforeSpawn = new FakeBridge({ onRequest: (request, reply) => {
    reply({ version: 1, requestId: request.requestId, success: true, data: PI_SUBAGENTS_RPC_V1_FIXTURE.ping });
    duringPing.abort();
  } });
  await assert.rejects(implementPhase(beforeSpawn.pi, "artifact-implementer", "task", "/tmp", { signal: duringPing.signal }), { name: "AbortError" });
  assert.deepEqual(beforeSpawn.methods, ["ping"]);

  const timeoutBridge = new FakeBridge({ onRequest: (request, reply) => {
    if (request.method === "ping") reply({ version: 1, requestId: request.requestId, success: true, data: PI_SUBAGENTS_RPC_V1_FIXTURE.ping });
  } });
  await assert.rejects(
    implementPhase(timeoutBridge.pi, "artifact-implementer", "task", "/tmp", { rpcTimeoutMs: 5, runTimeoutMs: 0 }),
    { name: "Error", message: "RPC spawn timed out" },
  );
  assert.deepEqual(timeoutBridge.methods, ["ping", "spawn"]);
  assert.equal(timeoutBridge.handlers.size, 0);
});

test("caller progress normalizes unsafe activity text before truncation", async () => {
  const controls = Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join("")
    + Array.from({ length: 33 }, (_, index) => String.fromCharCode(127 + index)).join("") + "\u2028\u2029";
  const bridge = statusBridge([
    { state: "running", activity: { currentTool: `${controls}bash${controls}read${controls}${"x".repeat(200)}` } },
    { state: "running", children: [{ state: "running", activity: { currentTool: `${controls}nested${controls}tool` } }] },
    { state: "running", activity: { currentTool: controls } },
    { state: "complete" },
  ]);
  const labels: Array<string | undefined> = [];
  await implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    pollIntervalMs: 0, completionGraceMs: 0,
    onProgress: (progress) => { if (progress.state === "running") labels.push(progress.activity?.currentTool); },
  });
  assert.deepEqual(labels, [`bash read ${"x".repeat(150)}`, "nested tool", undefined]);
});

for (const abortAfterTimeout of [false, true]) {
  test(`late spawn timeout reply is stopped with captured timeout cause (later abort=${abortAfterTimeout})`, async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const controller = new AbortController();
    let childState = "running";
    let releaseSpawn: (() => void) | undefined;
    const bridge = new FakeBridge({ onRequest: (request, reply) => {
      const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
      if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
      if (request.method === "spawn") {
        releaseSpawn = () => respond({ text: "spawned", details: { runId: "late-run" } });
        return;
      }
      assert.equal(request.params.id, "late-run");
      if (request.method === "interrupt") childState = "paused";
      if (request.method === "stop") childState = "stopped";
      if (request.method === "status") return respond({ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "late-run", state: childState }] } });
      respond({ text: request.method });
    } });
    const result = implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
      rpcTimeoutMs: 5, runTimeoutMs: 100, signal: controller.signal,
    });
    const rejected = assert.rejects(result, { message: "RPC spawn timed out" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(releaseSpawn);
    context.mock.timers.tick(5);
    await rejected;
    assert.equal(childState, "running");
    assert.deepEqual(bridge.methods, ["ping", "spawn"]);
    assert.equal(bridge.handlers.size, 1);
    if (abortAfterTimeout) controller.abort();
    releaseSpawn();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(childState, "stopped");
    assert.deepEqual(bridge.methods, ["ping", "spawn", "stop", "status"]);
    assert.equal(bridge.handlers.size, 0);
  });
}

test("delayed spawn reply leaves only the emission-anchored window for completion", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let stopRequested = false;
  const statusTimes: number[] = [];
  const bridge = new FakeBridge({ onRequest: (request, reply) => {
    const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
    if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
    if (request.method === "spawn") {
      setTimeout(() => respond({ text: "spawned", details: { runId: "delayed-deadline-run" } }), 80);
      return;
    }
    if (request.method === "stop") {
      stopRequested = true;
      return respond({ text: "stopped" });
    }
    if (request.method === "status") {
      statusTimes.push(Date.now());
      if (stopRequested) return respond({ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "delayed-deadline-run", state: "stopped" }] } });
      return;
    }
  } });
  const result = implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    rpcTimeoutMs: 1_000, runTimeoutMs: 100, pollIntervalMs: 0, completionGraceMs: 0,
  });
  const rejected = assert.rejects(result, /implementation phase timed out after 100ms/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  context.mock.timers.tick(80);
  await new Promise<void>((resolve) => setImmediate(resolve));
  context.mock.timers.tick(0);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(statusTimes, [80]);
  context.mock.timers.tick(19);
  assert.equal(bridge.handlers.size, 2);
  context.mock.timers.tick(1);
  await rejected;
  assert.equal(bridge.methods.includes("stop"), true);
  assert.equal(bridge.handlers.size, 0);
});

test("unanswered spawn reply listener expires at the runtime deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const bridge = new FakeBridge({ onRequest: (request, reply) => {
    if (request.method === "ping") reply({ version: 1, requestId: request.requestId, success: true, data: PI_SUBAGENTS_RPC_V1_FIXTURE.ping });
  } });
  const rejected = assert.rejects(implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    rpcTimeoutMs: 5, runTimeoutMs: 100,
  }), { message: "RPC spawn timed out" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  context.mock.timers.tick(5);
  await rejected;
  assert.equal(bridge.handlers.size, 1);
  context.mock.timers.tick(94);
  assert.equal(bridge.handlers.size, 1);
  context.mock.timers.tick(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(bridge.handlers.size, 0);
  assert.deepEqual(bridge.methods, ["ping", "spawn"]);
});
test("terminal status just before deadline accepts a completion event within grace after the deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let settled = false;
  const bridge = new FakeBridge({ onRequest: (request, reply) => {
    const respond = (data: Record<string, unknown>) => reply({ version: 1, requestId: request.requestId, success: true, data });
    if (request.method === "ping") return respond(PI_SUBAGENTS_RPC_V1_FIXTURE.ping);
    if (request.method === "spawn") return respond({ text: "spawned", details: { runId: "grace-run" } });
    if (request.method === "status") {
      setTimeout(() => bridge.emitCompletion({ runId: "grace-run", state: "complete", output: "rich event payload" }), 2);
      return respond({ asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, runs: [{ id: "grace-run", state: "complete" }] } });
    }
    assert.fail(`Unexpected cleanup RPC: ${request.method}`);
  } });

  const result = implementPhase(bridge.pi, "artifact-implementer", "task", "/tmp", {
    runTimeoutMs: 100, pollIntervalMs: 99, completionGraceMs: 10,
  });
  result.finally(() => { settled = true; }).catch(() => {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  context.mock.timers.tick(99);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(bridge.methods, ["ping", "spawn", "status"]);
  context.mock.timers.tick(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  context.mock.timers.tick(1);

  assert.deepEqual(await result, {
    runId: "grace-run",
    state: "complete",
    payload: { runId: "grace-run", state: "complete", output: "rich event payload" },
  });
  assert.deepEqual(bridge.methods, ["ping", "spawn", "status"]);
  assert.equal(bridge.handlers.size, 0);
});
