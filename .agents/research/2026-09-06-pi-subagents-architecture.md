# Research: pi-subagents architecture

Date: 2026-09-06

Repository: `https://github.com/nicobailon/pi-subagents`

Local checkout: `~/.cache/checkouts/github.com/nicobailon/pi-subagents`

Inspected ref: `main` at `1deda8643f5e32856b7475642b2f35b819bbbecf`

## Question

How does `pi-subagents` implement child-agent delegation, orchestration, isolation, and recovery?

## Summary

`pi-subagents` is a Pi extension that registers one parent-facing `subagent` tool. It is an execution runtime rather than a planning system:

- Markdown agent definitions describe child roles.
- The parent Pi chooses when to delegate.
- Workflow JavaScript describes sequencing and fanout.
- The extension owns child-session creation, lifecycle, budgets, isolation, persistence, and recovery.
- Missions provide durable records but do not automatically replan or restart work.

## pi-rpi integration verdict

The integration is **partly correct**. Package agent discovery, the v1 RPC transport, async completion events, and status snapshots match the supported `pi-subagents` interfaces. The implementation-phase contract and timeout ownership need correction.

The current installed package is `pi-subagents` 0.64.0. `pi-rpi` requires 0.50+ (`README.md:63-67`), which is the first release that added the RPC `asyncSnapshot` consumed by this adapter. The audited upstream checkout is newer (`main` at `1deda8643f5e32856b7475642b2f35b819bbbecf`), but the relevant RPC shapes are present in the installed 0.64.0 package.

What is correct:

- `package.json` exposes `./agents` through `pi.subagents.agents`, one of the two documented installed-package discovery forms (`pi-subagents/docs/agents.md:15-32`).
- `src/agent-runtime.ts:27-71` uses the documented `subagents:rpc:v1:request` and per-request reply envelope. Upstream explicitly supports this extension-to-extension seam (`pi-subagents/docs/extension-api.md:96-123`).
- RPC spawn is intentionally detached and async-only (`pi-subagents/src/extension/rpc.ts:510-520`). That is useful while implementation agents depend on ambient extension tools: background children load ambient extensions, while foreground children do not (`pi-subagents/docs/agents.md:396-410`).
- `src/agent-runtime.ts:86-110` correlates `subagent:async-complete` by run ID and falls back to targeted status polling. Both are public RPC capabilities (`pi-subagents/docs/extension-api.md:125-150`).
- Keeping one implementation writer in the shared checkout is consistent with the RPI phase protocol (`skills/implement-plan/SKILL.md:8-22`; `skills/implement-outline/SKILL.md:8-22`).

What is not fully correct:

1. **A single implementation child is unnecessarily wrapped in `workflowScript`.** `implementPhase()` creates `return runs.run("main", ...)` at `src/agent-runtime.ts:226-232`. Upstream says to use direct `{ agent, task }` for one bounded child and reserve `workflowScript` for sequencing, fanout, steering, retry, or aggregation (`pi-subagents/docs/workflows.md:44-48`). The wrapper adds workflow and mission state but no orchestration value. It is not the main runtime cost, but it complicates timeout and status behavior.
2. **The advertised phase timeout is not passed to the child runtime.** The 900,000 ms default is applied only to `waitForCompletion()` after spawn (`src/agent-runtime.ts:226-235`). The spawned composite workflow receives no `timeoutMs` (`src/agent-runtime.ts:227`), and composite async workflows have no default parent deadline (`pi-subagents/docs/workflows.md:79-98`; `pi-subagents/docs/tool-reference.md:108-113`). The adapter therefore owns a polling deadline while the runtime sees an unbounded workflow.
3. **Timeout and RPC request deadlines are one field.** `RunOptions.timeoutMs` controls each RPC reply timer (`src/agent-runtime.ts:8-16, 27-53`) and the whole completion wait (`src/agent-runtime.ts:80-113`). A phase timeout should not also allow one status RPC to consume that full duration. Separate RPC, child-runtime, and completion-grace deadlines.
4. **Cleanup does not guarantee a terminal stop.** `interruptThenStopOwnedRun()` returns as soon as interrupt succeeds (`src/agent-runtime.ts:179-185`). Interrupt is a resumable pause, while RPC `stop` records a terminal `stopped` lifecycle (`pi-subagents/docs/extension-api.md:123-126`). A phase timeout should normally stop the owned run; caller cancellation may intentionally interrupt it, but that policy must be explicit.
5. **The adapter rejects the supported terminal `partial` state.** `RUN_STATES` and `TERMINAL_STATES` omit `partial` (`src/agent-runtime.ts:74-76`), while current status snapshots include it for workflow timeout or budget outcomes (`pi-subagents/src/runs/shared/async-status-projection.ts:17-29`; `pi-subagents/docs/workflows.md:95-99`). Such a result is currently reported as an invalid status and triggers cleanup rather than returning its settled evidence.
6. **A fresh child is told to discover parent-owned artifact context that it does not receive.** The orchestrator intentionally sends only a short phase name (`skills/implement-plan/SKILL.md:21`; `skills/implement-outline/SKILL.md:21`). The child then has to find and reread the plan, outline, research, design inputs, and every referenced file (`agents/artifact-implementer.md:14-24`; `agents/artifact-outline-implementer.md:14-23`). `extensions/artifacts.ts:700-705` knows the exact active task directory but passes only the model-authored `phaseTask` and `cwd`.
7. **The child artifact-tool contract is internally inconsistent.** Both implementation agents allow only `rpi_update_artifact`, not `rpi_get_task_context`, `rpi_list_artifacts`, or `rpi_read_artifact` (`agents/artifact-implementer.md:1-9`; `agents/artifact-outline-implementer.md:1-9`). Yet they are told to read artifacts through RPI tools and the outline agent is told to update progress. In a fresh child, active-task selection is not guaranteed because `currentTask()` restores it from that Pi session's branch (`extensions/artifacts.ts:177-208`). The parent should pass the exact task slug and artifact path, or the child should receive a complete tool-and-selection contract.
8. **Artifact ownership and the human gate conflict across prompts.** The child is told to stop for human confirmation and update completion (`agents/artifact-outline-implementer.md:26-29`), while the parent workflow says the child returns first and the parent owns the human gate and later artifact update (`skills/implement-outline/SKILL.md:22-44`). This can make a child wait, contact the supervisor, or attempt an update that belongs to the parent.
9. **Writer acceptance is inferred from task wording instead of declared by the agent.** The implementation agents omit `acceptanceRole: writer`. `pi-subagents` supports that declaration and otherwise uses name/task heuristics (`pi-subagents/src/runs/shared/acceptance.ts:88-132`). A recovery prompt containing words such as “inspect” was locally classified read-only even though the child edited files. That weakens evidence checks and makes behavior depend on prompt wording.
10. **Progress is technically live but not informative.** RPI emits only root state and poll count (`src/agent-runtime.ts:6-16, 95-104`; `extensions/artifacts.ts:697-705`). The v1 status snapshot can also include child activity, current tool, timestamps, turns, and tool count (`pi-subagents/src/runs/shared/async-status-projection.ts:35-68`). Ignoring those fields makes a productive 10-minute run look stalled.

## Why implementation phases take a long time

The dominant cost is the child workload, not the two-second RPC polling interval.

A local, retained sample of 37 workflow-mode implementation runs found:

- 19 completed, 12 stopped, and 6 failed.
- Completed median: 8.9 minutes; average: 10.0 minutes; 90th percentile: 19.6 minutes.
- A completed run averaged 41 model turns, 81 tool calls, and 216,063 reported tokens.
- Stopped runs cluster exactly at configured 4, 15, 20, and 30 minute deadlines, confirming that the adapter often ends still-active work rather than naturally completing a small slice.

This is observational history, not a controlled model benchmark. The retained files are under `/var/folders/.../pi-subagents-uid-501/async-subagent-runs/`.

Two representative runs explain the cost:

- Run `922d370b-f078-4318-85c1-2ba199be0c21` completed a small navigator badge phase in 7.16 minutes, but still used 24 turns, 61 tools, and 129,856 tokens. It loaded several global/project skills, searched for an outline outside the selected task protocol, ran focused tests, formatting, link validation, React Doctor twice, and the full `pnpm check` gate.
- Run `0ccbdbed-ab93-423e-9006-8b41d8a13a8f` took 22.1 minutes, 52 turns, 95 tools, and 242,747 tokens. It could not find the structure outline, spent about 3.4 minutes in a supervisor decision, read many source/test/dependency files, repeatedly formatted and tested, and ran the full gate more than once while recovering work from a prior 30-minute stopped run.

The concrete causes, ordered by impact:

1. **Phases are too large for a single model run.** A “thin vertical slice” may still span schema, API, UI, tests, docs, and changelog (`agents/artifact-outline-implementer.md:14-24`). Local runs reaching 60-160 tools are not bite-sized execution slices.
2. **The child must reconstruct task context.** Fresh context is a valid isolation choice, but the task omits an authoritative artifact path and exact phase excerpt. The agent searches the repository, parent session artifacts, temp outputs, or supervisor channel before it can implement.
3. **Verification is broad and repeated.** The child must run build, test, and lint (`agents/artifact-implementer.md:32-35`) and “broader codebase” verification (`agents/artifact-implementer.md:21-24`). Repository rules can expand this into thousands of tests, docs checks, formatters, and UI-specific checks. Fixes then repeat those gates.
4. **Model choice is inherited.** The implementation agents declare `thinking: medium` but no model (`agents/artifact-implementer.md:1-9`; `agents/artifact-outline-implementer.md:1-9`). The observed long runs used `gpt-5.6-sol` or `gpt-5.6-terra`; the workflow offers no RPI-level model policy or override.
5. **The current UI hides useful activity.** A long sequence of productive tool calls appears only as `running` plus a poll count, so perceived latency is worse and operators cannot steer early.
6. **`workflowScript` overhead is secondary.** It adds a sandbox, mission, workflow receipt, and nested status layer, but observed runs spend nearly all elapsed time inside the implementation child. Switching to direct spawn is still the right simplification, not a standalone latency fix.

## Recommended correction order

### P0 — correctness and context

1. Spawn implementation as a direct RPC single child: `{ agent, task, context: "fresh", cwd, timeoutMs }`. Keep workflow scripts for research fanout only.
2. Build the child task inside `extensions/artifacts.ts` from trusted data. Include the exact task slug, absolute task directory, authoritative plan/outline path, phase heading, allowed changed surface, focused verification command, and manual checks. Do not rely on a model-authored `phaseTask` to carry hidden parent state.
3. Make the implementer code-only. It should return “ready for manual verification,” never wait for human confirmation, and never update phase/artifact status. Remove `rpi_update_artifact` from the child unless a complete fresh-session selection protocol is deliberately added. Keep artifact updates and the human gate in the parent.
4. Add `acceptanceRole: writer` to both implementation agents.
5. Pass the run timeout to `pi-subagents`, recognize `partial`, and separate `rpcTimeoutMs`, `runTimeoutMs`, and local completion grace. Use terminal `stop` on phase timeout; reserve resumable `interrupt` for explicit cancellation/recovery policy.

### P1 — reduce work and improve visibility

1. Tighten phase planning around one observable behavior and one focused test command. Split a phase before launch when its required changed surface or verification spans unrelated subsystems. Do not use a hard tool budget for writers; upstream recommends a narrow task plus an outer timeout (`pi-subagents/docs/tool-reference.md:125-129`).
2. Run focused behavior tests in the child. Run the full repository gate once in the parent after the phase diff stabilizes, unless the plan explicitly makes that gate part of the child task.
3. Project child activity from `asyncSnapshot` into RPI updates: elapsed time, model, current tool, turns, and tool count. Add a checkpoint/steer action before a long-run threshold rather than waiting for the hard deadline.
4. Add a configurable implementation model policy. A faster implementation model should be selectable without changing the parent session model; keep stronger models for escalation or difficult recovery phases.
5. Send RPC `ping` before launch so a missing bridge or unsupported method fails quickly. Do not attach `preflight` to the proposed direct child request: current public input accepts preflight only with `workflowScript` or `workflowScriptPath` (`pi-subagents/src/extension/public-execution.ts:94-99`).

### P2 — verification

Add integration coverage against a real installed `pi-subagents` runtime, not only a fake event bus. Tests should prove:

- a fresh implementation child receives the exact selected task and authoritative artifact path;
- its required tools are available;
- direct single-child RPC spawn returns the expected completion payload;
- runtime timeout produces a terminal stopped/partial result without an orphan;
- caller cancellation follows the chosen pause-or-stop policy;
- `partial` status and event payloads are preserved;
- live progress includes child activity rather than only poll count.

## Execution model

```text
Parent Pi
  -> subagent tool
  -> public input normalization
  -> agent discovery and launch-contract resolution
  -> foreground child or detached runner
  -> child Pi session
  -> result, status, and artifacts
```

### Direct child execution

A direct request uses `{ agent, task }`. The public execution boundary normalizes and validates this shape in `src/extension/public-execution.ts`.

The child launch is assembled in `src/runs/shared/child-launch.ts`. It resolves tools, extensions, MCP selections, context inheritance, model ceilings, permissions, structured output, and nested-run metadata before creating the session.

### Foreground execution

With `async: false`, the child runs in the parent process as an in-process Pi session. `src/runs/shared/child-session.ts` wraps Pi's `createAgentSession` behind a `ChildSessionFactory`. Each child gets a separate resource loader and session, while children share a `ModelRuntime`.

`src/runs/foreground/execution.ts` owns prompting, progress, control, timeout handling, structured output, acceptance, and final result construction.

### Background execution

Async execution creates durable run state and starts a detached runner process. The runner later creates child Pi sessions independently. This lets child extensions, MCP tools, and provider extensions load in the runner without sharing the parent session's extension state.

Relevant implementation files:

- `src/runs/background/async-execution.ts`
- `src/runs/background/subagent-runner.ts`
- `src/runs/background/result-watcher.ts`
- `src/runs/background/async-status.ts`

Run artifacts include status, event, result, output, transcript, and control files. The parent watches those artifacts and publishes completion notifications and status projections.

## Agent definitions

Agents are Markdown files containing YAML frontmatter followed by a system prompt. Builtins include `scout`, `researcher`, `worker`, `reviewer`, `oracle`, and `delegate`.

Discovery is implemented in `src/agents/agents.ts` and documented in `docs/agents.md`. Project agents override user, package, and builtin definitions when names collide. Definitions can control:

- Description and system prompt
- Tools and excluded tools
- Model and fallback models
- Thinking level
- Skills and extensions
- Context inheritance
- Acceptance role
- Output behavior
- Whether nested subagents are allowed

## Workflow orchestration

Current public orchestration uses `workflowScript` or `workflowScriptPath`. Legacy top-level `chain`, `parallel`, and `tasks` inputs are rejected.

A workflow script exposes:

- `runs.run(key, params)` for one child
- `runs.all([...])` for bounded parallel fanout
- `runs.lanes([...])` for independent sequential lanes
- `runs.steer(key, message, options)` for steering a launched child
- `state.get(key)` and `state.set(key, value)` when a mission is attached

Example:

```js
const scan = await runs.run("scan", {
  agent: "scout",
  task: "Inspect the authentication flow"
});

const reviews = await runs.all([
  { key: "correctness", agent: "reviewer", task: "Review correctness" },
  { key: "tests", agent: "reviewer", task: "Review test coverage" }
]);

return reviews.map((result) => result.output);
```

The script is evaluated in a worker-thread sandbox implemented by `src/workflows/scripted-workflow.ts`. Acorn performs static validation. Runtime promise tracking detects unobserved child launches and rejects workflow completion when a `runs.run` promise was not awaited, returned, or consumed by a supported combinator.

`runs.all()` returns an ordered array. It intentionally does not return a key-value map. `runs.lanes()` validates the complete lane inventory before launching children and marks only the affected lane blocked when a child fails, detaches, stops, or returns `structuredOutput.verdict === "blocked"`.

## Context and child boundaries

Children can use fresh or forked context. Forked context is derived from the parent session and can be pruned under a bounded session budget. Parent-only orchestration history and subagent control messages are removed from forked child context.

By default, child sessions do not receive the bundled `pi-subagents` skill and do not receive the `subagent` tool. Nested delegation is an explicit exception controlled by the agent definition and maximum depth.

Runtime metadata carries depth, fanout budgets, capability ceilings, nested routes, parent identity, and thinking ceilings. These are inherited and intersected rather than freely widened by children.

## Safety and verification controls

Launch contracts capture the effective child configuration before execution. Controls include:

- Tool allowlists and exclusions
- MCP tool selection
- Capability ceilings
- Permission rules and audit files
- Maximum nesting depth
- Per-workflow child-spawn limits
- Tool-call budgets and timeouts
- Reported token and cost budgets
- Structured-output schemas
- Acceptance evidence
- Model response verification and exclusions

A hard tool budget normally blocks read/search tools after the limit, while the final response remains available so the child can report its state. Workflow timeouts and budgets produce partial terminal outcomes and preserve settled child evidence for recovery.

## Worktree isolation

Workflows can request `isolation: "worktree"`. `src/runs/shared/worktree.ts` handles clean-checkout validation, named-base-ref resolution, branch and worktree creation, setup hooks, diff capture, and cleanup planning.

Worktree cleanup distinguishes preserving captured work from discarding it. The system does not silently discard unexpected changes. Worktree operations are serialized through a transaction guard.

## Missions and retained children

A workflow gets an enclosing mission by default. Mission records link:

- Objective
- Workflow and child run IDs
- Lifecycle status
- Decisions
- Usage
- Artifacts
- Delivery receipts
- Resumable retained-child metadata

Retained children can be resumed with a new workflow key:

```js
const next = await runs.run("followup", {
  resume: previous.runId,
  task: "Revisit the previous result and address this concern"
});
```

The retained child keeps its stored agent, model, tools, and contract. `resume` and `agent` are mutually exclusive. The caller must use a run ID that the system reports as resumable.

Missions and schedules are recovery and record-keeping mechanisms. They do not independently launch replacement work or make product decisions.

## Extension integration

Public integration seams include:

- `pi-subagents/delegation` for structured extension-to-extension delegation
- `pi-subagents/workflow-resources` for trusted, bounded named workflows
- `pi-subagents/preflight` for inspecting resolved launch contracts
- `pi-subagents/agents` for runtime agent registration
- `pi-subagents/external-runs` for display-only FleetView jobs
- `pi-subagents/background-work` for provider-backed background work
- In-process RPC through `subagents:rpc:v1:*` events

Trusted workflow resources can bind fixed host commands to fixed workflow keys. Public callers can provide bounded JSON arguments, but cannot grant arbitrary shell commands or workflow-resource permits.

## Relevance to pi-rpi

The strongest reusable ideas for `pi-rpi` are:

1. Keep public execution inputs narrow and reject legacy orchestration shapes explicitly.
2. Resolve a launch contract before starting work, then persist enough of it to explain and recover the run.
3. Separate foreground execution from detached execution while retaining one child-session abstraction.
4. Treat workflow orchestration as a small, typed runtime with bounded fanout and explicit promise observation.
5. Keep mission records, run state, and delivery receipts distinct.
6. Use explicit resumability and retained run IDs rather than assuming every interrupted child can continue.
7. Make trusted host execution an extension-owned capability, not a free-form public argument.

`pi-rpi` currently operates at a higher artifact/planning layer. It should borrow these execution and boundary patterns only where it needs durable delegation, rather than reproducing the full FleetView, runner, or Pi-session machinery.

## Audit evidence added

Local integration files:

- `README.md`
- `package.json`
- `src/agent-runtime.ts`
- `extensions/artifacts.ts`
- `agents/artifact-implementer.md`
- `agents/artifact-outline-implementer.md`
- `skills/implement-plan/SKILL.md`
- `skills/implement-outline/SKILL.md`
- `test/engine/agent-runtime.test.ts`
- `test/engine/artifacts-extension.test.ts`

Upstream integration and behavior sources:

- `docs/extension-api.md`
- `docs/workflows.md`
- `docs/tool-reference.md`
- `docs/agents.md`
- `src/extension/rpc.ts`
- `src/extension/public-execution.ts`
- `src/runs/shared/acceptance.ts`
- `src/runs/shared/async-status-projection.ts`

Retained local run evidence:

- `0ccbdbed-ab93-423e-9006-8b41d8a13a8f/status.json`
- `13999b7f-be96-4b23-86aa-af3616f11d9b/status.json`
- `922d370b-f078-4318-85c1-2ba199be0c21/status.json`

## Source files read

- `README.md`
- `docs/agents.md`
- `docs/configuration.md`
- `docs/workflows.md`
- `docs/tool-reference.md`
- `docs/missions.md`
- `docs/extension-api.md`
- `index.ts`
- `src/extension/index.ts`
- `src/extension/public-execution.ts`
- `src/runs/foreground/execution.ts`
- `src/runs/foreground/subagent-executor.ts`
- `src/runs/background/async-execution.ts`
- `src/runs/background/subagent-runner.ts`
- `src/runs/shared/child-session.ts`
- `src/runs/shared/child-launch.ts`
- `src/runs/shared/worktree.ts`
- `src/workflows/scripted-workflow.ts`
- `src/api/delegation.ts`
- `src/api/workflow-resources.ts`
