---
name: implement-plan
description: "Orchestrates phased implementation of the plan using one implementer agent per phase with human gates. Use after the plan is approved; the plan is the source of truth for each phase."
---

# Implement Plan

Orchestrate phased implementation of the plan. You are the orchestrator: launch one Pi implementer for one phase, verify its work, wait at the human gate, and commit one phase at a time. Never run phases in parallel or assign several phases to one run.

## Setup

1. Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to discover current artifacts and statuses.
2. Read the `plan` fully with `rpi_read_artifact`, then read the `structure-outline` and its relevant inputs when they are needed for context. Do not read or edit artifact files directly; task artifacts live under `.pi/artifacts/` and are managed by RPI tools.
3. The plan is the source of truth for every phase. When it conflicts with an input artifact, stop and use the mismatch procedure rather than choosing a different design.
4. Identify Phase 1 or the first unchecked phase, and read its automated and manual verification requirements before launching an implementer.

## Phase Protocol

For each phase, starting with Phase 1 or the first unchecked:

1. Launch exactly one implementer with `rpi_implement_phase`: agent `artifact-implementer`, `phaseId` set to the phase number/title, and a short `phaseTask` that names only that phase. Keep the task short; the implementer reads the plan.
2. Keep the returned `runId`. Review the complete result for completed work, deviations, failed or missing checks, and requested manual steps. If the run does not complete successfully, stop. Do not mark progress, commit, create an implementation artifact, or record a phase commit.
3. Run any automated verification the implementer missed, including the plan's stated build, test, lint, or formatting commands. Investigate and fix failures before the gate. Mark a plan checkbox only after the required automated verification passes, using `rpi_update_artifact` so the manifest remains current.
4. Report the phase to the human using this format:

   ```markdown
   ## Phase [N] Implementation Summary

   **Completed by implementer:**
   - [Completed work]

   **Automated verification:**
   - [Command and result]

   **Manual verification required:**
   - [Manual checks from the plan]
   ```

5. Present the manual-verification gate to the human and wait for confirmation before committing. Do not commit, record the phase commit, mark the phase complete, or start another phase before that confirmation. This gate applies to every phase, including consecutive phases requested in one session.
6. Commit the phase's code with `ci-commit`; never commit the artifact root. Capture the resulting commit SHA.
7. Create or update the `implementation` artifact through `rpi_create_artifact` or `rpi_update_artifact` after the verified work. Set `dependsOn: ["plan"]`.
8. Call `rpi_record_phase_commit` only after the human gate and Git commit, with `phaseId`, the returned `runId`, and the verified commit SHA.
9. Repeat for the next phase only after steps 1–8 complete. Use a separate implementer run and verification cycle for every phase.

## Stops and Mismatches

- If the plan cannot be followed, present: **Plan requirement**, **Code reality**, **Consequence**, and **Requested direction**. Wait for guidance before proceeding. Consider `iterate-plan` only when the user directs a plan update.
- When resuming, use the plan's checkboxes to select the first unchecked phase. Trust completed work unless something is inconsistent.
- Never bypass a failed automated check or the manual gate. Never create a phase receipt for an uncommitted or unverified phase.

## Final Response

After every completed phase, provide its implementation summary, automated verification results, and manual verification list. After the final phase, read the completed plan and load `references/implement_plan_final_answer.md` only as a concise response-shape guide. Report the local plan and implementation artifact paths, phase commit SHAs, and the next registered RPI workflow; do not use legacy remote links or unavailable commands from that reference.
