---
name: implement-plan
description: Orchestrates phased implementation of the plan using one implementer agent per phase with human gates. Use after the plan is approved; the plan is the source of truth for each phase.
---

# Implement Plan

Orchestrate phased implementation of the plan. You are the orchestrator: one implementer per phase, verification by you, human gate, commit per phase. Never run phases in parallel.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Locate the `plan` artifact (and the outline) with `rpi_read_artifact`; the plan is the source of truth.

## Process

For each phase, starting with Phase 1 or the first unchecked:

1. Launch exactly one implementer: `rpi_implement_phase` with agent `artifact-implementer`, `phaseId` = the phase number/title, and a short `phaseTask` naming the phase. Keep the prompt short — the implementer reads the plan.
2. Review the implementer's output: what was accomplished, mismatches, manual steps requested.
3. Run automated checks the implementer may have missed (build, test, lint per the plan's Automated Verification).
4. Present the manual-verification gate and wait for the human's confirmation before committing.
5. Commit the phase's changes (see `ci-commit`); never commit the artifact root.
6. Repeat for the next phase; separate launches with verification between, even for consecutive phases.

Resuming: check the plan's checkboxes (`- [x]`); instruct the implementer to resume from the first unchecked item. Trust completed work unless something seems off.

Mismatch: if the implementer reports an issue or the plan cannot be followed, present it clearly (Expected / Found / Why this matters / How should I proceed?) and wait for guidance. Consider whether the plan needs updating via `iterate-plan`.

## Final response

Per phase, report a summary, automated verification results, and the manual verification list. After the final phase, read the plan's final state and report the full recap.
