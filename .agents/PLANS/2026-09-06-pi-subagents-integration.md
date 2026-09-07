# pi-subagents integration correction plan

## Scope

Correct `pi-rpi`'s single-child delegation, timeout ownership, task-context handoff, agent responsibilities, and live progress. Close the reviewed timeout, flow, phase-scope, partial-result, and documentation gaps without weakening the one-writer phase protocol or automated and human verification gates.

Source: `.agents/research/2026-09-06-pi-subagents-architecture.md`.

## Baseline

- Installed runtime: `pi-subagents` 0.64.0; package requirement remains 0.50+.
- Upstream reference: `nicobailon/pi-subagents` `main` at `1deda8643f5e32856b7475642b2f35b819bbbecf`.
- `npm run typecheck && npm test`: passed, 100 tests.
- Existing unrelated changes in `.agents/PLANS/2026-09-03-extension-ux-conformance.md` and `.agents/research/` must be preserved.

## Desired end state

- One implementation or review agent launches as one direct async RPC child. Only research fanout uses `workflowScript`.
- `timeoutMs` on `rpi_implement_phase` is enforced by `pi-subagents`, with a short client-side completion grace rather than a competing deadline.
- RPC reply deadlines, child-runtime deadlines, and completion grace are separate values.
- `partial` is a preserved terminal result and is rendered as a distinct warning, not mislabeled as a generic failure.
- An implementation phase can use an approved `ticket` as authoritative source in the `oneshot` flow.
- A supplied phase ID resolves exactly once to a phase in the approved source artifact before a child is launched.
- A timeout stops its owned child. An explicit caller cancellation interrupts it for possible recovery, falling back to stop only when interrupt fails.
- Every implementation child receives the selected task slug, exact task directory, authoritative approved plan, structure-outline, or oneshot ticket path, canonical phase ID, and caller instruction.
- Implementation children write code and report evidence only. The parent owns artifact mutation, the human gate, commit, and phase receipt.
- Live progress shows available child activity instead of only state and poll count.
- Implementation model selection is optional and explicit; omitting it preserves inherited-model behavior.
- Phase-writing skills discourage slices that require unrelated subsystems or several broad verification loops.
- Final installed-runtime verification runs in a named Tuistory session, using reactive waits and terminal snapshots as evidence.

## Non-goals

- Do not replace `pi-subagents`, copy its runner, or add a second job store.
- Do not move research fanout away from `workflowScript`.
- Do not add hard writer tool budgets; the upstream guidance favors narrow tasks plus a runtime timeout.
- Do not hardcode a supposedly faster model.
- Do not auto-edit task artifacts from a fresh child.
- Do not add `preflight` to direct child calls. In the installed public contract, `preflight` applies only to `workflowScript`/`workflowScriptPath`; use RPC `ping` and launch validation instead.
- Do not change the manual confirmation, one-writer, commit, or receipt sequence.
- Do not add Tuistory as a project dependency solely for this verification; use the installed CLI.

## Implementation approach

Keep the event-bus RPC because detached children load the ambient extension tools named by the packaged agents. Simplify the implementation and review requests at the public `pi-subagents` boundary, then make the RPI extension build a complete phase envelope with a validated source artifact and canonical phase identity before launch. Keep runtime mechanics in `src/agent-runtime.ts`, task/artifact policy in `extensions/artifacts.ts`, and orchestration policy in the agent and skill Markdown files.

---

## Phase 1: Make single-child execution and lifecycle ownership correct

### Files

- `src/agent-runtime.ts`
- `test/engine/agent-runtime.test.ts`

### Changes

1. Replace stringly typed lifecycle handling with discoverable public shapes:

   ```ts
   export type RunState =
     | "queued"
     | "running"
     | "complete"
     | "failed"
     | "partial"
     | "paused"
     | "stopped"
     | "rejected";

   export interface RunActivity {
     currentTool?: string;
     turnCount?: number;
     toolCount?: number;
   }

   export interface RunProgress {
     runId: string;
     state: RunState;
     pollCount: number;
     activity?: RunActivity;
   }
   ```

   Parse optional fields defensively so older 0.50+ snapshots still work. Normalize `completed` to `complete`, and treat `partial` as terminal without treating it as success.

2. Split timing options:

   ```ts
   export interface RunOptions {
     signal?: AbortSignal;
     rpcTimeoutMs?: number;       // default 20 seconds
     runTimeoutMs?: number;       // runtime-owned child/workflow timeout
     completionGraceMs?: number;  // short status/event flush window
     pollIntervalMs?: number;
     onSpawn?: (runId: string) => Promise<void>;
     onProgress?: (progress: RunProgress) => Promise<void> | void;
   }
   ```

   Keep the public `rpi_implement_phase.timeoutMs` field, but map it to `runTimeoutMs` at the extension boundary. Do not retain an internal `timeoutMs` alias unless a documented external TypeScript contract requires it.

3. Add `assertSubagentsRpcAvailable()` that sends `ping` with `rpcTimeoutMs`, validates protocol version 1, and checks that `spawn`, `status`, `interrupt`, and `stop` are advertised. Run it before each top-level launch so a missing extension fails in seconds with actionable install guidance rather than at the phase deadline.

4. Replace the implementation workflow wrapper with direct async spawn:

   ```ts
   rpcCall(pi, "spawn", {
     agent,
     task,
     context: "fresh",
     cwd,
     async: true,
     timeoutMs: runTimeoutMs,
     ...(model ? { model } : {}),
   }, options)
   ```

   Apply the same direct shape to `reviewImplementation()`. Preserve `runs.all()` for `startResearch()` and pass its runtime timeout at the workflow root.

5. Anchor completion waiting to the runtime deadline established when spawn is emitted. A delayed spawn reply or receipt write must not grant a fresh runtime window. The local wait may allow terminal completion-event flush time beyond `runTimeoutMs`, but must not be the primary enforcement mechanism.

   - Calculate `remainingMs` immediately before every delay and status request.
   - Cap each in-flight status RPC with `rpcTimeoutMs: Math.min(options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS, Math.max(1, remainingMs))`; never let a status request run past the child deadline merely because the adapter's RPC deadline is longer.
   - When that bounded status request expires at the run deadline, raise `runDeadlineError()` so implementation callers receive the phase-timeout error and owned cleanup runs; do not surface a generic `RPC status timed out` error for a run deadline.
   - Keep completion-event grace only after a terminal status has been observed. The grace is for event/status flush, not a second implementation deadline.

6. Split cleanup by the primary cause captured when it occurs:

   - `stopOwnedRun()` for runtime/client timeout, invalid status, failed receipt persistence, or another non-cancellation adapter error. A caller abort after a timeout has already won must not reclassify late cleanup as cancellation.
   - `interruptOwnedRun()` for caller `AbortSignal`; call `stopOwnedRun()` only when interrupt is unsupported or fails. Cancellation after spawn emission must reject the caller promptly while one bounded reply listener remains to recover and clean up a late run ID.

   After requesting stop, perform bounded status reconciliation so tests and callers can prove the run reached a terminal state or receive an explicit cleanup warning. Never silently report a stopped run as complete.

### Tests

Update the fake RPC bridge and add focused cases proving:

- `ping` precedes spawn and missing capabilities fail before spawn;
- implementation and review spawn direct `{ agent, task }` requests without `workflowScript`;
- research still spawns one `runs.all()` workflow;
- configured runtime timeout is present in the spawn payload;
- RPC timeout remains 20 seconds unless independently overridden;
- `partial` works through status and `subagent:async-complete` payloads;
- timeout calls `stop`, caller cancellation calls `interrupt`, and failed interrupt falls back to `stop`;
- cancellation while the spawn reply is pending rejects promptly, retains one bounded late-reply listener, and cleans up a late run ID according to the captured cancellation cause;
- a timeout remains stop-owned even if the caller aborts before the late spawn reply arrives;
- an in-flight status RPC cannot outlive a short `runTimeoutMs`, produces `RunTimeoutError`/the implementation timeout error, and still performs owned stop cleanup;
- delayed spawn replies do not extend the emission-anchored runtime deadline;
- optional activity fields are parsed while snapshots without activity remain accepted.

### Automated verification

- `node --experimental-strip-types --test --test-name-pattern='implementPhase|startResearch|rpcCall|completion|cancellation' test/engine/agent-runtime.test.ts`
- `npm run typecheck`

---

## Phase 2: Give the child authoritative task context and one owner for artifacts

### Files

- `extensions/artifacts.ts`
- `agents/artifact-implementer.md`
- `agents/artifact-outline-implementer.md`
- `skills/implement-plan/SKILL.md`
- `skills/implement-outline/SKILL.md`
- `test/engine/artifacts-extension.test.ts`
- `test/engine/package.test.ts`

### Changes

1. Add a pure `buildImplementationPhaseTask()` helper near the existing run formatting helpers. Its input is trusted extension state, not only model-authored prose:

   ```ts
   interface ImplementationPhaseTaskInput {
     taskSlug: string;
     taskDir: string;
     sourceArtifactType: "ticket" | "plan" | "structure-outline";
     sourceArtifactPath: string;
     phaseId: string;
     instruction: string;
   }
   ```

   The generated prompt must identify:

   - selected task slug;
   - absolute task directory;
   - authoritative artifact type and absolute file path;
   - exact phase ID;
   - caller instruction as an explicitly labeled supplement;
   - code-only ownership and the required final evidence shape.

   Do not ask the child to discover the active task or update the artifact. Keep `ImplementationPhaseTaskInput` and `buildImplementationPhaseTask()` private to the extension; the public tool seam, not a test-only export, is the contract that tests must exercise.

2. In `rpi_implement_phase.execute()`:

   - reload the active manifest with `loadManifest(active.taskDir)`;
   - map `artifact-outline-implementer` to `structure-outline`; map `artifact-implementer` to `ticket` for `oneshot` and to `plan` for `rpi`/`prd` flows;
   - resolve the active artifact with `findArtifact()`;
   - reject a missing, superseded, or non-approved source before spawn;
   - build the absolute source path from the validated manifest path and read its content before spawn;
   - for a `ticket` source, accept only the single canonical phase ID `implementation`; for a plan or outline, parse the exact `## Phase N: title` heading in that source and require `phaseId` to be its heading text `Phase N: title`, without leading `##` or the completion check mark; reject unknown, aliased, or ambiguous IDs; use the matched canonical ID in the task envelope, run receipt, and progress labels;
   - pass the generated task envelope to `implementPhase()`.

   Use one small resolver for ticket, plan, and outline sources; it must return one canonical phase ID or an actionable error:

   ```ts
   function resolveImplementationPhase(sourceType: "ticket" | "plan" | "structure-outline", source: string, requestedPhaseId: string): string {
     if (sourceType === "ticket") {
       if (requestedPhaseId.trim() !== "implementation") throw new Error("Oneshot ticket implementation must use phase ID \"implementation\".");
       return "implementation";
     }
     const headings = [...source.matchAll(/^##\s+(?:✅\s+)?(Phase\s+\d+(?::[^\r\n]*)?)\s*$/gim)].map((match) => match[1]!.trim());
     const matches = headings.filter((heading) => heading === requestedPhaseId.trim());
     if (matches.length !== 1) throw new Error(`Implementation phase "${requestedPhaseId}" must match exactly one phase heading in the authoritative artifact.`);
     return matches[0]!;
   }
   ```

   Standardize `phaseId` in `implement-plan` and `implement-outline` to the exact heading text without Markdown syntax (for example, `Phase 1: Add direct RPC cleanup`); standardize oneshot callers on `implementation`, and update the tool description/tests accordingly. Do not accept a leading `##` alias or an arbitrary `phase-1` value that is absent from the source artifact. Bound `phaseId` and `phaseTask` lengths in the TypeBox schema to prevent an accidentally huge child prompt. Keep `phaseTask` for phase-specific clarification, not hidden task selection.

3. Make both implementation agents code-only:

   - remove `rpi_update_artifact` from `tools`;
   - add `acceptanceRole: writer`;
   - keep `defaultContext: fresh` and one-writer language;
   - allow `artifact-implementer` to implement from the approved `ticket` source in `oneshot`; it must not require a plan for that flow;
   - require `phaseId` to be the canonical `implementation` ID for ticket-backed oneshot work, or the exact phase heading for plan/outline work;
   - tell the child to read the exact authoritative path in its task, then only the source files it must change;
   - run the phase's focused automated criteria, not an unconditional full-repository gate;
   - return changed files, exact commands/results, residual risks, and manual checks;
   - use `contact_supervisor` only for a real plan/code conflict;
   - return “ready for parent verification” rather than waiting for a human or marking completion.

4. Make parent ownership explicit in `implement-plan` and `implement-outline`: the parent reviews the child diff, runs any missing phase check, presents the human gate, updates the artifact, commits, and records the receipt. Remove wording that expects the child to find the active artifact itself.

### Tests

Add cases proving:

- the selected slug, task directory, authoritative artifact path, canonical phase ID, and caller instruction all appear in the spawn task;
- plan and outline agents choose different source artifact types, and a oneshot implementer uses the approved ticket path with phase ID `implementation`;
- launch rejects a missing or unapproved authoritative artifact without sending RPC spawn;
- launch rejects an unknown or ambiguous plan/outline phase heading and any oneshot phase ID other than `implementation`;
- traversal cannot enter through the manifest path or phase fields;
- packaged implementation agents declare writer acceptance and do not expose `rpi_update_artifact`;
- the task-envelope assertion goes through `rpi_implement_phase`; no test imports an internal task-builder export.
- implementation skills retain the parent-owned human gate and artifact update, and use canonical phase IDs.

Update existing extension fixtures to create and approve a plan/outline (with a real `## Phase N: title` heading), or an approved ticket for oneshot (with phase ID `implementation`), before invoking `rpi_implement_phase`; do not weaken the new launch precondition to keep old tests convenient.

### Automated verification

- `node --experimental-strip-types --test --test-name-pattern='rpi_implement_phase|package.*agent|implementation agent' test/engine/artifacts-extension.test.ts test/engine/package.test.ts`
- `npm run typecheck`

---

## Phase 3: Reduce phase rediscovery and duplicate verification

### Files

- `skills/create-plan/SKILL.md`
- `skills/create-plan/references/plan_template.md`
- `skills/create-structure-outline/SKILL.md`
- `skills/create-structure-outline/references/structure_outline_template.md`
- `skills/implement-plan/SKILL.md`
- `skills/implement-outline/SKILL.md`
- `test/engine/package.test.ts`

### Changes

1. Add a phase-size gate to plan and outline creation:

   - one observable behavior per phase;
   - one focused automated verification group;
   - no unrelated data/UI/docs work bundled only because it shares a milestone;
   - split the phase when the implementer would need to rediscover an unstated subsystem or run several unrelated broad gates.

   Preserve vertical slices: tests stay with the behavior they prove. Do not impose a brittle fixed file-count or tool-count limit. Keep phase headings in the parseable `## Phase N: title` form; callers use that exact heading as `phaseId`.

2. Require each phase to name:

   - authoritative files or code surfaces;
   - focused automated commands and expected results;
   - manual checks only where automation cannot prove behavior;
   - whether the full repository gate is intentionally required for that phase;
   - the exact phase ID, which is the heading text `Phase N: title` with the leading `##` and any completion marker omitted.

3. Clarify verification ownership:

   - child: focused phase checks and fixes;
   - parent: any omitted phase checks, then the manual gate;
   - final parent handoff: one full `npm run typecheck && npm test`-equivalent repository gate after all phase diffs stabilize.

4. Update implementation task instructions so a child starts from the exact source path and canonical phase ID provided by the extension. Plan/outline callers pass the heading text without Markdown syntax (`Phase N: title`); oneshot callers pass `implementation`. The child may read dependencies named by the phase, but should not scan task stores, session artifacts, temp directories, or missions to rediscover its assignment.

### Tests

Extend the existing static skill tests to assert the durable contract rather than exact prose:

- one phase/one writer;
- exact source path supplied by the tool;
- focused child verification;
- parent-owned full gate and human confirmation;
- no child-owned artifact mutation.

### Automated verification

- `node --experimental-strip-types --test test/engine/package.test.ts`
- `npm run typecheck`

---

## Phase 4: Surface useful activity and optional model selection

### Files

- `src/agent-runtime.ts`
- `extensions/artifacts.ts`
- `test/engine/agent-runtime.test.ts`
- `test/engine/artifacts-extension.test.ts`
- `README.md`

### Changes

1. Extend `AgentRunProgressDetails` and `emitAgentRunProgress()` with optional `currentTool`, `turnCount`, and `toolCount`. Retain `runId`, `state`, `phaseId`, and `pollCount` in details for identity and diagnostics, but replace the poll count in compact text with useful activity when activity exists.

   Example partial output:

   ```text
   implementation phase 2 run abc123: running · bash · 12 turns · 24 tools
   ```

   Fall back to the current state/poll text for older snapshots.

2. Traverse the target snapshot node to the active child/leaf when handling research workflows; for direct implementation/review runs, use the root activity. Bound all labels copied from upstream status.

3. Add optional `model` to `rpi_implement_phase` and `ImplementationPhaseOptions`, and pass it directly to the public spawn request. Omission must preserve the current inherited-model behavior.

4. Document that model choice changes speed/cost/quality and should come from the user or project policy. Do not select a model automatically from historical timing data.

5. Give `partial` its own terminal presentation in `implementationRunText()` and `renderAgentRunResult()`: use warning styling and wording such as `completed partially`, preserve the run ID and evidence payload, and reserve `failed with state`/error styling for failed, stopped, rejected, or timed-out outcomes. A partial result is not success, but it is not a generic failure either.

### Tests

Add cases for:

- rich activity rendering;
- fallback rendering with a minimal 0.50-era snapshot;
- nested workflow activity selection for research;
- bounded untrusted tool labels;
- model passthrough and omitted-model behavior;
- compact and expanded final renderers remaining stable for success, a final `partial` result rendered as a warning without the word `failed`, timeout, and failure.

### Automated verification

- `node --experimental-strip-types --test --test-name-pattern='progress|render|model|partial' test/engine/agent-runtime.test.ts test/engine/artifacts-extension.test.ts`
- `npm run typecheck`

---

## Phase 5: Prove the installed-runtime boundary and document the change

### Files

- `README.md`
- `CHANGELOG.md`
- `test/engine/agent-runtime.test.ts`
- optional `docs/` or `scripts/` live-smoke instructions if the repository already has a suitable location
- `test/engine/package.test.ts`

### Changes

1. Add a protocol contract fixture based on the installed 0.64.0 RPC `ping`, spawn, complete public status snapshot, completion event, interrupt, and stop envelopes. Include required root snapshot fields (`generatedAt`, `caps`, and `omitted`) and required run fields (`kind` and `label`). Keep a separate minimal older-snapshot case for permissive parser compatibility. Keep the fixture data local and bounded; tests must not read a user's global `~/.pi` installation.

2. Document an explicit Tuistory-driven live smoke procedure for a developer with `pi-subagents` installed:

   - select an RPI task with an approved plan/outline containing a disposable one-file phase, or an approved oneshot ticket for the canonical `implementation` phase;
   - launch `rpi_implement_phase` with a short timeout and verify the child receives the exact artifact path;
   - confirm the run appears as a direct single run rather than a workflow/mission;
   - confirm live current-tool/turn/tool counts appear;
   - confirm success returns evidence without changing the artifact;
   - separately run a timeout fixture and verify no live/orphan run remains;
   - separately cancel a run and verify it is paused/resumable rather than falsely complete.

3. Update README agent-run documentation for direct implementation/review execution, timeout and cancellation semantics, source-artifact requirements (including an approved ticket for oneshot), canonical phase IDs, progress details, and optional model selection.

4. Make `CHANGELOG.md` valid before adding the user-visible correction: keep exactly one `## Unreleased` heading, remove the erroneous literal `-## Unreleased` line, and add one concise past-tense bullet covering the correction. Follow the repository release-note style and do not split this into internal implementation bullets. Add a package test that rejects duplicate or bullet-prefixed Unreleased headings so this typo cannot recur.

### Automated verification

- `npm run typecheck`
- `npm test`
- `git diff --check`
- `node --experimental-strip-types --test --test-name-pattern='changelog' test/engine/package.test.ts`

### Manual verification with Tuistory

Use a dedicated named Tuistory session so the verifier can drive Pi, wait on real terminal output, preserve the full output stream, and let the human attach to the same session when needed.

Before the first Tuistory action in the implementation session, follow the Tuistory skill requirement: read the full outputs of `tuistory --help` and the upstream README. Never use blind `sleep` calls.

1. Check existing sessions, choose an unused name such as `pi-rpi-subagents-smoke`, and never reuse or close a session owned by someone else:

   ```sh
   tuistory sessions --json
   ```

2. Launch Pi 0.84.4+ from the repository in a wide terminal:

   ```sh
   tuistory -s pi-rpi-subagents-smoke --cols 160 --rows 48 --cwd "$PWD" -- pi
   tuistory -s pi-rpi-subagents-smoke wait-idle --timeout 15000
   tuistory -s pi-rpi-subagents-smoke snapshot --trim
   ```

3. Drive the prepared approved one-file RPI phase with `type` followed by `press enter`. After **every** `type`, `press`, or other terminal action, run `snapshot --trim`. Use `wait` with explicit timeouts for observable milestones:

   ```sh
   tuistory -s pi-rpi-subagents-smoke type "Run the prepared disposable RPI implementation phase and report its run ID."
   tuistory -s pi-rpi-subagents-smoke snapshot --trim
   tuistory -s pi-rpi-subagents-smoke press enter
   tuistory -s pi-rpi-subagents-smoke snapshot --trim
   tuistory -s pi-rpi-subagents-smoke wait "/implementation phase .* running/i" --timeout 30000
   tuistory -s pi-rpi-subagents-smoke snapshot --trim
   tuistory -s pi-rpi-subagents-smoke wait "/Implementation phase .* (completed|failed|partial|timed out)/i" --timeout 960000
   tuistory -s pi-rpi-subagents-smoke snapshot --trim
   ```

   Verify from the output and `pi-subagents` status that the child received the exact artifact path, appeared as a direct single run rather than a workflow/mission, emitted current-tool/turn/tool-count progress, returned evidence, used the canonical phase ID, and did not mutate the source artifact. For the oneshot variant, verify the authoritative path is `ticket.md` and the phase ID is `implementation`.

4. In the same dedicated session, run the timeout fixture and use bounded `wait`/`snapshot` calls to prove the run becomes terminal and leaves no active child. Then launch the cancellation fixture, wait until it reports running, send the displayed interrupt key (`press esc` in Pi 0.84.4), immediately snapshot, and prove the run is paused/resumable rather than reported complete.

5. Preserve evidence before teardown:

   ```sh
   tuistory read -s pi-rpi-subagents-smoke --all
   tuistory -s pi-rpi-subagents-smoke snapshot --trim
   ```

   Record the session name, exact run IDs, terminal states, progress fields observed, cancellation result, and orphan check in the final verification report.

6. Repeat the direct spawn/status smoke against the audited current upstream checkout. When all evidence is captured, close only the dedicated session created by this verification:

   ```sh
   tuistory -s pi-rpi-subagents-smoke close
   ```

   If the verifier did not create that session, leave it running.

## Implementation order and gates

Implement phases 1–5 sequentially. Each phase must pass its focused commands before review. After each phase, inspect the actual diff rather than relying on the implementer's summary. Do not begin the next phase until the current phase's automated checks and human gate pass.

Before handoff, run the full gate once more:

```sh
npm run typecheck && npm test
git diff --check
```

The final verification report must list exact commands, the Tuistory session name, live smoke run IDs, captured terminal evidence, installed-version differences, and residual risks.
