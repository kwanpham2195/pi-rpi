# Sample task walkthrough

A complete rpi-flow task, from pasted ticket to research. Run this in any empty git repo with the package installed (`pi install -l /path/to/pi-artifacts`).

## 1. Initialize

```text
/rpi-init
```

Expected: `.pi/artifacts/` exists and `.gitignore` contains `.pi/artifacts`.

## 2. Create the task

Prompt:

```text
Create task slug eng-1478-parent-child, title "Parent-child tracking",
flow rpi, ticket body:
# ENG-1478
Track parent-child relationships for sessions.
```

Expected:

```text
.pi/artifacts/eng-1478-parent-child/
├── artifact-manifest.json
└── 00-ticket.md
```

The TUI footer now shows `eng-1478-parent-child · rpi`.

## 3. Research questions

Invoke the `create-research-questions` skill.

Expected: `01-<slug>.md` (draft) with 2-8 neutral current-state questions.

## 4. Research

Invoke the `create-research` skill. It runs a 2-6 node fanout (`artifact-locator`, `artifact-analyzer`, ...), waits for all children, and synthesizes.

Expected: `02-<slug>.md` (draft, depends on research-questions) with file:line citations, story-style headers, testing patterns.

## 5. Approve

```text
/rpi-approve research
```

Wait — direct approve is blocked (`draft → approved` is invalid). Two-step:

```text
# prompt: set research to in-review, then to approved (rpi_set_artifact_status)
```

Expected: research `approved`, manifest receipts `status-change` + `approval`.

## 6. What to do next

Continue the rpi flow: `create-design-discussion` → `create-structure-outline` → (optional `create-plan`) → `implement-outline` or `implement-plan` (one phase at a time, human gate per phase, `ci-commit` per phase) → `describe-pr`.

## Oneshoot variant

```text
Create task slug hotfix-1234, flow oneshot, ticket body <pasted fix>
```

Only `implementation` and `pr-description` artifacts are enabled. Try to create `research` and the tool rejects it: "not enabled in flow oneshot".

## Resume

Reopen the task in a fresh session (`/rpi-task eng-1478-parent-child`). The manifest restores the active task; plan/outline checkboxes mark implemented phases; receipts carry run IDs for resumable agent work.

## Troubleshooting

- `rpi_start_research` says the agents are not registered: the package must be **installed** (`pi install`), not just loaded with `-e`. Agents are only discovered from installed package manifests.
- `Unmanaged write into artifact root` warning: use `rpi_create_artifact` / `rpi_update_artifact` for artifact files.
- `Invalid status transition draft -> approved`: go through `in-review` first.
