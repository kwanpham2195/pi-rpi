---
name: iterate-plan
description: Updates the plan artifact in place from feedback. Use when code shapes, phases, or verification need to change before or during implementation.
---

# Iterate Plan

Update the existing plan artifact in place.

## Setup

- Ensure the active task is selected.
- Read the current `plan` artifact and its inputs with `rpi_read_artifact`.

## Process

1. Ask for feedback if none is given.
2. Verify code examples and paths against the code before applying; never apply blindly.
3. Update in place with `rpi_update_artifact`. Keep exact code shapes current and the checkbox list intact.
4. Keep phases independently verifiable; no phase depending on a later one.

## Final response

Confirm the update and any revised phases.
