---
name: iterate-implementation
description: Applies follow-up fixes to implemented work for the active task. Use when the user reports bugs or changes after implementation phases landed; unstarted phases still go through the implementer.
---

# Iterate Implementation

Apply follow-up work on an implemented task: bug fixes, feedback, or small changes.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read the `plan` (or the outline if no plan exists) and the relevant artifacts; check `git diff` and recent commits to understand what landed.

## Process

1. Understand the current state: which phases landed, what changed since the base branch.
2. For feedback:
   - A bug: ask for reproduction steps or logs; reproduce before fixing.
   - Multiple approaches: ask the user which to take.
3. Apply the fix, then run the relevant tests and linting.
4. Unstarted phases must go through `rpi_implement_phase` with the implementer — never implement a whole unstarted phase inline.
5. Update the plan's checkboxes if a phase completed.

## Final response

Report what changed, the verification run, and any remaining items.
