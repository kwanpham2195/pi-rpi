---
name: implement-outline
description: "Orchestrates phased implementation directly from the structure outline using one outline-implementer agent per phase with human gates. Use after the outline is approved when no detailed plan exists."
---

# Implement Outline

Orchestrate phased implementation of the structure outline. You are the orchestrator: you launch one implementer per phase, verify, gate on the human, and commit. Never run phases in parallel.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read the `structure-outline`, `research`, and `design-discussion` artifacts with `rpi_read_artifact`.

## Process

For each phase, starting with Phase 1 or the first unchecked:

1. Launch exactly one implementer: `rpi_implement_phase` with agent `artifact-outline-implementer`, `phaseId` = the phase number/title, and a short `phaseTask` naming the phase (the implementer reads the outline itself; do not duplicate it).
2. Review the implementer's output: what was accomplished, any mismatches, requested manual steps.
3. Run automated checks the implementer may have missed (build, test, lint per the outline's Automated Verification).
4. Present the manual-verification gate to the human and wait for confirmation before committing.
5. Commit the phase's changes (see `ci-commit`); never commit the artifact root.
6. Repeat for the next phase; separate launches even for consecutive phases, with verification between.

Resuming: locate progress by the outline's checkboxes; the implementer marks `- [ ]` → `- [x]` as automated verification passes and `## Phase N:` → `## ✅ Phase N:` only after the human confirms manual verification. Trust completed work unless something seems off.

Mismatch: if the implementer reports an issue, present it to the human (Expected / Found / Why this matters / How should I proceed?) and wait for guidance.

## Final response

Per phase, report a summary, automated verification results, and the manual verification list. After the final phase, report the full implementation recap.
