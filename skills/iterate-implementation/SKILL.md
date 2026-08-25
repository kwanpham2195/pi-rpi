---
name: iterate-implementation
description: "Applies follow-up fixes to implemented work for the active task. Use when the user reports bugs or changes after implementation phases landed; unstarted phases still go through the implementer."
---

# Iterate Implementation

Apply follow-up work on an implemented task: bug fixes, feedback, or small changes. This skill does not silently expand an unstarted implementation phase.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to find the current plan, structure outline, implementation record, and related inputs.
- Read the plan with `rpi_read_artifact`; if no plan exists, read the structure outline. Read the relevant design, research, and ticket artifacts only when needed for the feedback. Check `git diff` and the commits after implementation to identify what landed.

## Process

1. Establish the current state: identify completed and unstarted phases, the implementation boundary, and changes since that boundary.
2. Verify feedback before changing code. For a bug, get sufficient reproduction steps or logs, reproduce it when possible, and inspect the cited code and tests. For a factual uncertainty, use `rpi_start_research` with 2-6 appropriate installed research nodes before deciding. Do not accept a reported correction blindly.
3. If there are multiple valid approaches, explain the options and tradeoffs, then wait for the user's direction. If more logs or reproduction evidence are needed, add the minimal useful logging and wait for the result rather than guessing.
4. Apply a clear, approved follow-up fix. Run the relevant tests and linting. Do not claim completion while a required check fails.
5. If the user wants an unstarted phase implemented, use `rpi_implement_phase` for exactly that phase: agent `artifact-implementer` when a plan exists, otherwise `artifact-outline-implementer`. Do not implement an unstarted whole phase inline. Review its result, run missed automated checks, and preserve its manual-verification gate before proceeding.
6. Update plan or outline checkboxes only after their required automated verification passes, using `rpi_update_artifact`. Preserve the completed-marker and human-gate rules in the governing artifact.

## Stops

- Stop for a mismatch between the governing artifact and code reality. Report the artifact requirement, code reality, consequence, and requested direction; do not silently change scope or architecture.
- Stop after a failed automated check, unresolved reproduction, or required manual-verification gate. Do not begin a later phase until the gate passes.

## Final Response

- When all requested iteration issues are resolved and no further changes are needed, load `references/iterate_implementation_final_answer.md` for its concise completion shape.
- Otherwise report the changed files, verification results, current stop or remaining item, and the next required user action.
- Treat the reference as wording guidance only. Report Pi manifest-relative artifact paths and registered RPI workflow names; do not use legacy paths, remote links, or unavailable commands from it.
