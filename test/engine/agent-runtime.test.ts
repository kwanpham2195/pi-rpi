import { test } from "node:test";
import assert from "node:assert/strict";
import { startResearch } from "../../src/agent-runtime.ts";
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
            success: true,
            data: { runId: "wf-run-1", state: "running" },
          } as never);
        } else if (req.method === "status") {
          statusCalls += 1;
          handlers.get(`subagents:rpc:v1:reply:${req.requestId}`)?.({
            success: true,
            data: { state: "complete" },
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

test("startResearch emits a spawn with a runs.all script and returns the runId", async () => {
  const { pi, captured } = fakePi();
  const receipt = await startResearch(
    pi,
    ["artifact-locator", "artifact-analyzer"],
    ["find files", "analyze files"],
    "/tmp/x",
  );
  assert.equal(receipt.runId, "wf-run-1");
  assert.equal(receipt.state, "complete");
  const spawn = captured.find((c) => c.method === "spawn");
  assert.ok(spawn);
  const script = String((spawn?.params as { workflowScript?: string })?.workflowScript ?? "");
  assert.match(script, /runs\.all/);
  assert.match(script, /artifact-locator/);
  assert.match(script, /artifact-analyzer/);
  assert.match(script, /"n0"/);
  assert.match(script, /"n1"/);
});
