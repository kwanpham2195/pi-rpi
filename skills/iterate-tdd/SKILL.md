---
name: iterate-tdd
description: Updates the TDD artifact in place as technical decisions evolve. Use when the user gives feedback or corrects system or program design.
---

# Iterate TDD

Update the existing TDD artifact in place.

## Setup

- Ensure the active task is selected.
- Read the current `tdd`, `prd`, `design-discussion`, `research`, and `ticket` artifacts with `rpi_read_artifact`.

## Process

1. Determine the path: feedback, continue grilling one decision at a time, or surface questions.
2. For system design, present options as diagrams/types/endpoints; for program design, as code-shape options.
3. Verify corrections; update in place with `rpi_update_artifact`; update mermaid and diagram artifacts to match.
4. Stop and ask "what next" after each change.

## Final response

Confirm the update and whether the gates still stand.
