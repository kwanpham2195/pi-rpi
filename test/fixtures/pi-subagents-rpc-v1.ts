/** Bounded pi-subagents 0.64.0 RPC v1 reply data and async completion event payload. */
export const PI_SUBAGENTS_RPC_V1_FIXTURE = {
  ping: {
    version: 1,
    methods: ["ping", "status", "manage", "spawn", "steer", "interrupt", "stop"],
  },
  spawn: {
    text: "spawned",
    details: { runId: "fixture-run" },
  },
  status: {
    text: "running",
    asyncSnapshot: {
      kind: "pi-subagents.async-status-snapshot",
      version: 1,
      generatedAt: 1_788_739_200_000,
      caps: {
        maxRuns: 20,
        maxChildrenPerNode: 8,
        maxDepth: 3,
        maxStringLength: 160,
        maxSerializedBytes: 32 * 1024,
      },
      omitted: { runs: 0, children: 0, byteLimitExceeded: false },
      runs: [
        {
          id: "fixture-run",
          kind: "subagent",
          label: "artifact-implementer",
          state: "running",
          activity: { currentTool: "bash", turnCount: 1, toolCount: 2 },
        },
      ],
    },
  },
  completion: {
    runId: "fixture-run",
    state: "complete",
    results: [{ agent: "artifact-implementer", summary: "ready for parent verification" }],
    output: "fixture output",
  },
  interrupt: { text: "interrupt requested", details: { state: "paused" } },
  stop: { text: "stop requested", details: { state: "stopped" } },
} as const;
