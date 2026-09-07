# Extension UX conformance plan

## Scope

Address the reported Pi-extension UX and API-conformance gaps while preserving existing uncommitted workflow changes.

## Baseline

- `npm run typecheck && npm test`: passed (90 tests).
- Existing uncommitted changes already add agent run receipts, an implementation timeout, suggestion-based footer text, and related test updates. They do not address live run updates, mode guards, selection persistence, durable command output, or full mutation-queue coverage.

## Steps

1. Update `extensions/artifacts.ts` and its focused tests:
   - reject every slash command in print/JSON modes before a mutation or UI call;
   - replace hard-coded config paths and character-only output truncation with Pi exports;
   - persist/restore the selected task with a custom session entry, restore the footer at session start/tree changes, and inject selected-task context as a hidden custom message;
   - make the new-task picker descriptive and send its mechanical tool instruction as a hidden custom message;
   - append durable status entries with a renderer; render artifact edges and suggested actions;
   - block unmanaged built-in edit/write calls inside the managed artifact root and put every extension-managed mutation behind the shared manifest/path mutation queue;
   - add prompt snippets for phase-commit and Git-diff tools.
2. Update `src/agent-runtime.ts`, focused runtime tests, and agent-run tool adapters:
   - emit an immediate spawned-run update and live polling updates through Pi `onUpdate`;
   - provide compact partial and final tool rendering, retaining bounded terminal details.
3. Update README, samples, and changelog to describe durable selection/status output and agent progress; run focused then full checks.

## Constraints

- Existing dirty changes are user work and must be preserved.
- Do not add compatibility shims, remove intentional behavior, commit, or push.
- Do not use `--no-verify`.
- Extension UI APIs are called only after `ctx.hasUI` is true.
- Persisted session entry data is validated before it affects active-task state.
- Pi shared mutation queues stay in the extension adapter; engine locking remains independent.

## Corrections discovered during execution

- Pi's API provides no hidden form of `sendUserMessage`; use `pi.sendMessage({ display: false }, { triggerTurn: true })` for the `/rpi-new` mechanical instruction.
- `appendEntry` is durable but not model context. Hidden `before_agent_start` custom messages expose the selected task to the model without a visible repeated transcript row.
- Pi's shared queue is per path. A common task manifest queue serializes all RPI mutations for a task; blocking built-in `write`/`edit` under the root prevents unqueued external writes to artifact files.
