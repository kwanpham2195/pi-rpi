---
name: implement-outline
description: "Orchestrates phased implementation directly from the structure outline using one outline-implementer agent per phase with human gates. Use after the outline is approved when no detailed plan exists."
---

# Implement Outline

Orchestrate phased implementation of the structure outline. You are the orchestrator: launch one Pi implementer for one phase, verify its work, wait at the human gate, and commit. Never run phases in parallel or delegate a whole outline to one run. Do not invoke `implement-plan` or `create-plan`; this skill implements the outline directly.

## Setup

1. Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to discover its current artifacts and statuses.
2. Read the `structure-outline` fully with `rpi_read_artifact`. Read the `research`, `design-discussion`, and `ticket` artifacts that exist and are relevant. Do not read or edit artifact files directly; task artifacts live under `.pi/artifacts/` and are managed by RPI tools.
3. The structure outline is authoritative. When inputs conflict, use this precedence: structure outline, design discussion, research, then ticket.
4. Identify the first phase without a completed marker. Read every phase's automated and manual verification requirements before launching its implementer.

## Phase Protocol

For each phase, starting with Phase 1 or the first unchecked:

1. Launch exactly one implementer with `rpi_implement_phase`: agent `artifact-outline-implementer`, `phaseId` set to the phase number/title, and a short `phaseTask` that names only that phase. The implementer reads the outline itself; do not duplicate it in the task.
2. Keep the returned `runId`. Review the complete result for completed work, deviations, failed or missing checks, and requested manual steps. If the run does not complete successfully, stop. Do not mark progress, commit, create an implementation artifact, or record a phase commit.
3. Run any automated verification the implementer missed, including the outline's stated build, test, lint, or formatting commands. Investigate and fix failures before the gate. Mark automated checkboxes only after their checks pass; use `rpi_update_artifact` for any outline update so the manifest remains current.
4. Report the phase to the human using this format:

   ```markdown
   ## Phase [N] Implementation Summary

   **Completed by implementer:**
   - [Completed work]

   **Automated verification:**
   - [Command and result]

   **Manual verification required:**
   - [Manual checks from the outline]
   ```

5. Present the manual-verification gate and wait for the human to confirm the listed checks passed. Do not commit, record the phase commit, mark the phase complete, or start another phase before that confirmation. This gate applies to every phase, including consecutive phases requested in one session.
6. After confirmation, mark the phase complete in the outline through `rpi_update_artifact`, when a marker update is needed. Keep the existing protocol: `- [ ]` becomes `- [x]` only after automated verification, and `## Phase N:` becomes `## ✅ Phase N:` only after the human confirms manual verification.
7. Commit the phase's code with `ci-commit`; never commit the artifact root. Capture the resulting commit SHA.
8. Create or update the `implementation` artifact through `rpi_create_artifact` or `rpi_update_artifact` after the verified work. Set `dependsOn: ["structure-outline"]` when no plan is used, or `dependsOn: ["plan"]` when a plan exists.
9. Call `rpi_record_phase_commit` only after the human gate and Git commit, with `phaseId`, the returned `runId`, and the verified commit SHA.
10. Repeat for the next phase only after steps 1–9 complete. Use a separate implementer run and verification cycle for every phase.

## Stops and Mismatches

- On a mismatch, present: **Plan requirement**, **Code reality**, **Consequence**, and **Requested direction**. Wait for the human; do not silently change scope, architecture, or the outline.
- If the outline needs correction, stop implementation until the human directs an update through the local feedback flow or `iterate-structure-outline`.
- When resuming, trust completed work unless something is inconsistent. Use the outline's checkboxes and ✅ phase titles to select the first incomplete phase.
- Never bypass a failed automated check or the manual gate. Never create a phase receipt for an uncommitted or unverified phase.

## Final Response

After every completed phase, provide its implementation summary, automated verification results, and manual verification list. After the final phase, load `references/implement_outline_final_answer.md` only as a concise response-shape guide. Report the local outline and implementation artifact paths, phase commit SHAs, and the next registered RPI workflow; do not use legacy remote links or unavailable commands from that reference.
