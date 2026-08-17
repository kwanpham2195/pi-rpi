---
name: iterate-prd
description: Updates the PRD artifact in place as product decisions evolve. Use when the user gives feedback, wants more grilling, or surfaces questions on the PRD.
---

# Iterate PRD

Update the existing PRD artifact in place.

## Setup

- Ensure the active task is selected.
- Read the current `prd`, `design-discussion`, `research`, and `ticket` artifacts with `rpi_read_artifact`.

## Process

1. Determine the path: feedback to apply, continue grilling one decision at a time, or surface questions.
2. Verify corrections before applying; optionally run research children if a decision depends on codebase facts.
3. Update the document in place with `rpi_update_artifact` (never a wholesale rewrite). Update mockups to match and re-embed them.
4. Stop and ask "what next" after every change.

## Final response

Confirm the update and what remains before the solution-review gate.
