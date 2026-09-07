# pi-rpi

Local Research-Plan-Implement workflow for [Pi](https://pi.dev). It stores task documents and receipts in a local manifest.

## Install

`pi-rpi` is not published to npm. Install a checkout:

```bash
pi install -l /path/to/pi-rpi   # project-local
pi install /path/to/pi-rpi      # installed package
```

`pi -e /path/to/pi-rpi` loads extension tools and commands for development. It does not register package agents. Install the package before calling `rpi_start_research`, `rpi_implement_phase`, or `rpi_review_implementation`.

## Quick start

```text
/rpi-init
/rpi-new Add parent-child tracking to projects
/rpi-task
```

`/rpi-new [intent]` accepts task intent (and opens an editor when omitted), then opens a flow picker. The active LLM generates the title and slug, then creates and selects the chosen task flow. `/rpi-task [slug]` selects an existing task: without a slug it opens a picker, and with a slug it is a fast path. RPI stores the selected task in session history, so Pi restores it when you return to the session.

Flow presets:

```text
rpi:     research-questions → research → design-discussion → structure-outline → (plan, optional) → implementation → pr-description
prd:     research-questions → research → prd → tdd → structure-outline → (plan, optional) → implementation → pr-description
oneshot: ticket → implementation → pr-description
freeform: no enforced chain
```

`mockup` and `diagram` support rpi, prd, and oneshot flows. `ticket` is task input.

## Commands

- `/rpi-init` — create `.pi/artifacts/`, add artifact and local-workspace ignore entries, and create the default shared `.pi/workspace.json` without replacing an existing config.
- `/rpi-new [intent]` — choose a flow, then create and select a task from intent; the active LLM generates its title and slug.
- `/rpi-task [slug]` — select an existing task from a picker, or use a slug as a fast path. The Pi footer shows its flow, suggested actions, and artifact review count.
- `/rpi-change-base` — select the active task's Git base branch.
- `/rpi-annotate` — annotate the active task's artifact directory with Plannotator; feedback returns to the active agent.
- `/rpi-status` — show a durable selected-task report with stages, dependency edges, and suggested actions.
- `/rpi-artifacts` — show the same durable task report, including artifact paths and statuses.
- `/rpi-approve [artifact]` — approve an in-review artifact; opens a picker when omitted.

## Tools

- `rpi_create_task`, `rpi_get_task_context` — create or select a task.
- `rpi_list_artifacts`, `rpi_read_artifact` — inspect artifacts. Read and diff output is bounded. A truncation notice names a full-output path; artifact reads point to their source file, while generated output and Git diffs stay in a temporary file.
- `rpi_create_artifact`, `rpi_update_artifact`, `rpi_set_artifact_status` — mutate documents through the manifest engine. Artifact descriptions accept normal human text and become lowercase kebab-case filenames; slashes and dots are rejected. A non-ticket artifact can be created only after every declared dependency is approved.
- `rpi_start_research`, `rpi_implement_phase`, `rpi_review_implementation` — run installed package agents and record task-level run receipts. Research uses one `runs.all()` workflow; implementation and review use one direct async child each. Pi shows queued and running updates while these tools poll a run. Expand the completed tool result to read its bounded output. Research and review default to 600000 milliseconds; `rpi_implement_phase` accepts optional `timeoutMs`, a positive millisecond runtime deadline that defaults to 1200000; non-success terminal states include terminal evidence details, while `partial` is presented as a distinct warning.
- `rpi_record_phase_commit` — records a phase only after a supplied Git commit SHA is verified.
- `rpi_git_diff` — bounded read-only `base...HEAD` diff for implementation review.

## Manifest and commits

Task state lives in `.pi/artifacts/<slug>/artifact-manifest.json`. It includes artifact hashes, dependencies, status transitions, agent-run receipts, and verified phase-commit receipts. A run receipt proves an agent run, not human verification or a Git commit. In interactive Pi, `/rpi-status` and `/rpi-artifacts` add an expandable report to session history. Its collapsed row shows the next suggested action and a configured keybinding hint. RPC mode receives the report as a notification. For an active task, Pi's built-in footer shows `<slug> · <flow> · actions: <suggestions> · <count> in review`.

`/rpi-init` ignores the artifact root and `.pi/workspace.local.json`. It creates a shared single-repository worktree config that branches from `origin/main`, uses `~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}`, and copies local environment and Pi config files. It never replaces an existing `.pi/workspace.json` or writes `.pi/workspace.local.json`. The staging guard blocks broad, ambiguous, and artifact-root `git add` commands. Use explicit source paths with `ci-commit`; do not stage task artifacts in the implementation repository.

## Requirements

- Pi 0.84.4+
- pi-subagents 0.50+ installed separately with `pi install npm:pi-subagents`; required only for agent-run tools.
- Plannotator CLI (optional; required only for `/rpi-annotate`).

## Agent-run contract

Implementation phases require an active approved `plan` artifact for `artifact-implementer`, an active approved `structure-outline` for `artifact-outline-implementer`, or an approved `ticket` for `artifact-implementer` in the `oneshot` flow. The plan or outline source uses a `## Phase N: title` Markdown heading. Plan and outline callers set `phaseId` to the heading text `Phase N: title`, without leading `##` and without a completion marker; oneshot callers use exactly `implementation`. The extension passes the selected task slug, absolute task directory, authoritative artifact path, canonical phase ID, and caller instruction to the child. Children write code and tests and return evidence only; the parent owns artifact mutation, the human verification gate, commits, and phase receipts.

`rpi_implement_phase.timeoutMs` is sent to the installed `pi-subagents` runtime as its child timeout. RPC reply deadlines and the short completion-event grace are separate adapter concerns. A runtime timeout stops the owned child. Caller cancellation interrupts it for possible recovery and falls back to stop only when interrupt fails. A stopped, failed, rejected, or partial run is never reported as a successful complete run.

Run output retains `runId`, `state`, `pollCount`, and, for implementation, `phaseId`; live activity may include `currentTool`, `turnCount`, and `toolCount`. Model selection remains optional and explicit: it can change speed, cost, and quality, so choose it from user or project policy. Omitting `model` preserves inherited-model behavior.

## Development

```bash
npm run typecheck
npm test
```

## Installed runtime smoke test

Use the [installed-runtime Tuistory smoke procedure](docs/pi-subagents-smoke.md) with a dedicated session and disposable approved source. It covers successful execution, timeout cleanup, resumable cancellation, artifact integrity, run IDs and states, orphan detection, and session ownership.
