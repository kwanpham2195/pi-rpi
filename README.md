# pi-artifacts

Local-first Research-Plan-Implement workflow for [Pi](https://pi.dev). Task artifacts, a machine-readable manifest, specialist research/implementation agents, and a lightweight TUI — all local, no cloud.

pi-artifacts recreates the Riptide-class workflow (questions → research → design → outline → plan → phased implementation → PR) as an original, local Pi package. Every document, dependency, approval, and run receipt is recorded in `artifact-manifest.json`, so tasks survive restarts, sessions, and worktrees.

## Install

```bash
pi install npm:pi-artifacts          # user-wide
pi install -l npm:pi-artifacts       # project-local (scoped to this repo)
pi install /path/to/pi-artifacts     # local checkout
```

To try the extension surface without installing:

```bash
pi -e /path/to/pi-artifacts
```

Note: `-e` loads the extension (tools, commands, TUI). The specialist agents are only registered by pi-subagents when the package is **installed** (`pi install`), so agent launches (`rpi_start_research`, `rpi_implement_phase`, `rpi_review_implementation`) require a real install.

## Quick start

```text
/rpi-init                          # create .pi/artifacts/ and gitignore it
# in a prompt:
"Create task eng-1478-parent-child, flow rpi, ticket body <pasted ticket>"
# then run the workflow skills, or drive the tools directly
```

Flow presets:

```text
rpi:     research-questions → research → design-discussion → structure-outline → (plan, optional) → implement → PR
prd:     research-questions → research → prd → tdd → structure-outline → (plan, optional) → implement → PR
oneshot: ticket → implementation → pr-description
freeform: no enforced chain

`mockup` and `diagram` are auxiliary supporting artifacts available in rpi/prd/oneshot (create-prd/create-tdd produce them); `ticket` is created at task creation, not via the chain.
```

## Commands

| Command | Purpose |
|---------|---------|
| `/rpi-init` | Create `.pi/artifacts/`, append the gitignore entry. Idempotent. |
| `/rpi-new` | Structured task creation wizard: flow select, slug/title inputs, base branch, ticket editor. Validates and detects duplicates. |
| `/rpi-task <slug>` | Select or reopen the active task by slug. |
| `/rpi-status` | Show the active task, its stages, and the next action. |
| `/rpi-artifacts` | Render the artifact graph and statuses. |
| `/rpi-approve <artifact>` | Approve an artifact (requires in-review first). |

## Tools

- `rpi_create_task` — create a task with slug, title, flow, ticket.
- `rpi_get_task_context` — select the active task.
- `rpi_list_artifacts`, `rpi_read_artifact` — inspect.
- `rpi_create_artifact` — create a document; validates flow + dependencies, assigns the next `NN-` name, writes the file and the manifest under a per-task lock.
- `rpi_update_artifact` — update in place with content hashing.
- `rpi_set_artifact_status` — draft → in-review → approved → superseded, with transition validation and receipts.
- `rpi_start_research` — 2-6 parallel fresh read-only research children (needs install).
- `rpi_implement_phase` — one implementer agent for one phase; parent verifies, human gates (needs install).
- `rpi_review_implementation` — fresh read-only reviewer comparing plan to `base...HEAD` (needs install).

## Skills

22 skills drive the workflow: create/iterate for research-questions, research, design-discussion, prd, tdd, structure-outline, and plan; implement-outline and implement-plan (one implementer per phase, human gate, commit); iterate-implementation; setup-worktree and configure-workspaces; review-artifact-comments; describe-pr; ci-commit.

Key rules the skills enforce:

- **Precedence**: plan > outline > TDD > PRD > design > research > ticket (research-questions excluded). PRD and TDD are prd-flow only; design-discussion is rpi-flow only.
- **Interview pacing** (prd/tdd): one question per message, options + tradeoffs + recommendation, sign-off gates.
- **Structure outline**: thin vertical slices, each independently verifiable, no phase depending on a later one.
- **Implementation**: exactly one implementer per phase, one writer, human gate per phase, commit per phase.
- **Agent escalation**: children use `contact_supervisor` for decisions they must not make themselves.

## Manifest and the commit/ignore contract

Task state lives in `.pi/artifacts/<slug>/`:

```text
.pi/artifacts/<slug>/
├── artifact-manifest.json        # machine-readable source of truth
├── artifact-manifest.json.bak    # last good manifest (recovery)
└── NN-<description>.md           # chronological documents
```

The artifact root is **gitignored by default** (`/rpi-init` adds it). It is never committed to the implementation repo. `ci-commit` stages explicit paths only, and a `tool_call` guard refuses `git add` of artifact-root paths. For teams that want versioned artifacts, symlink the root to a separate artifacts repo.

## Requirements

- pi 0.80.3+ (extension API used here)
- pi-subagents 0.50+ (bundled; agent launches need it registered, which a real `pi install` provides)

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit + engine + package tests (node --experimental-strip-types)
```
