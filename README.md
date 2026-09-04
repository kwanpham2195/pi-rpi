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
- `rpi_start_research`, `rpi_implement_phase`, `rpi_review_implementation` — run installed package agents and record task-level run receipts. Pi shows queued and running updates while these tools poll a run. Expand the completed tool result to read its bounded output. `rpi_implement_phase` accepts optional `timeoutMs`, a positive millisecond execution deadline that defaults to 900000; non-success terminal states include failure details.
- `rpi_record_phase_commit` — records a phase only after a supplied Git commit SHA is verified.
- `rpi_git_diff` — bounded read-only `base...HEAD` diff for implementation review.

## Manifest and commits

Task state lives in `.pi/artifacts/<slug>/artifact-manifest.json`. It includes artifact hashes, dependencies, status transitions, agent-run receipts, and verified phase-commit receipts. A run receipt proves an agent run, not human verification or a Git commit. In interactive Pi, `/rpi-status` and `/rpi-artifacts` add an expandable report to session history. Its collapsed row shows the next suggested action and a configured keybinding hint. RPC mode receives the report as a notification. For an active task, Pi's built-in footer shows `<slug> · <flow> · actions: <suggestions> · <count> in review`.

`/rpi-init` ignores the artifact root and `.pi/workspace.local.json`. It creates a shared single-repository worktree config that branches from `origin/main`, uses `~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}`, and copies local environment and Pi config files. It never replaces an existing `.pi/workspace.json` or writes `.pi/workspace.local.json`. The staging guard blocks broad, ambiguous, and artifact-root `git add` commands. Use explicit source paths with `ci-commit`; do not stage task artifacts in the implementation repository.

## Requirements

- Pi 0.84.4+
- pi-subagents 0.50+ installed separately with `pi install npm:pi-subagents`; required only for agent-run tools.
- Plannotator CLI (optional; required only for `/rpi-annotate`).

## Development

```bash
npm run typecheck
npm test
```
