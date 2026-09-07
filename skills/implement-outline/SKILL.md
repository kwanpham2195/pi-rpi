---
name: implement-outline
description: "Orchestrates phased implementation directly from the structure outline using one code-only outline implementer per phase with parent-owned verification and human gates. Use after the outline is approved when no detailed plan exists."
---

# Implement Outline

Each phase is one observable behavior with one focused automated verification group and one writer; split unrelated subsystem work before launching the child.

Orchestrate phased implementation of the structure outline. You are the parent orchestrator: launch one code-only outline implementer for one phase, review its diff, run the missing checks, wait for the human gate, and commit. Never run phases in parallel or delegate a whole outline to one run.

## Setup

1. Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to discover current artifacts and statuses.
2. Read the `structure-outline` fully with `rpi_read_artifact`. Read the `research`, `design-discussion`, `prd`, `tdd`, and `ticket` artifacts that exist and are relevant. Do not read or edit artifact files directly; task artifacts live under `.pi/artifacts/` and are managed by RPI tools.
3. The structure outline is authoritative. When inputs conflict, use this precedence: structure outline, design discussion, research, then ticket.
4. Identify the first phase without a completed marker. Read every phase's automated and manual verification requirements before launching its implementer.

## Phase Protocol

For each phase, starting with Phase 1 or the first unchecked:

1. Launch exactly one implementer with `rpi_implement_phase`: agent `artifact-outline-implementer` and a short `phaseTask` that names only that phase. The structure-outline source uses a `## Phase N: title` Markdown heading; set `phaseId` to the heading text `Phase N: title`, without leading `##` and without a completion marker. The extension reloads the active manifest, requires an approved structure-outline, and gives the child the exact absolute task directory and outline path. Do not put hidden task selection or artifact mutation instructions in `phaseTask`.
2. Keep the returned `runId`. Review the complete result and the actual code diff for completed work, deviations, failed or missing checks, and requested manual steps. The child writes code and reports evidence only; it does not update artifacts, wait for a human, commit, or record a receipt. If the run does not complete successfully, stop. Do not mark progress, commit, create an implementation artifact, or record a phase commit.
3. Run any automated verification the child missed, including the outline's stated focused build, test, lint, or formatting commands. Investigate and fix failures before the gate. The child should verify the focused phase behavior; the parent runs omitted checks and the final full repository gate after all phase diffs stabilize.
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
6. After confirmation, mark the phase complete in the outline through the parent RPI artifact tools, when a marker update is needed. Keep the existing protocol: `- [ ]` becomes `- [x]` only after automated verification, and `## Phase N:` becomes `## ✅ Phase N:` only after the human confirms manual verification.
7. Commit the phase's code with `ci-commit`; never commit the artifact root. Capture the resulting commit SHA.
8. Create or update the `implementation` artifact through `rpi_create_artifact` or `rpi_update_artifact` after the verified work. Set `dependsOn: ["structure-outline"]` when no plan is used, or `dependsOn: ["plan"]` when a plan exists. The parent owns this artifact mutation.
9. Call `rpi_record_phase_commit` only after the human gate and Git commit, with `phaseId`, the returned `runId`, and the verified commit SHA.
10. Repeat for the next phase only after steps 1–9 complete. Use a separate implementer run and verification cycle for every phase.

## Stops and Mismatches

- On a mismatch, present: **Plan requirement**, **Code reality**, **Consequence**, and **Requested direction**. Wait for the human; do not silently change scope, architecture, or the outline.
- If the outline needs correction, stop implementation until the human directs an update through the local feedback flow or `iterate-structure-outline`.
- When resuming, trust completed work unless something is inconsistent. Use the outline's checkboxes and ✅ phase titles to select the first incomplete phase.
- Never bypass a failed automated check or the manual gate. Never create a phase receipt for an uncommitted or unverified phase.

## Final Response

After every completed phase, provide its implementation summary, automated verification results, and manual verification list. After the final phase, load `references/implement_outline_final_answer.md` only as a concise response-shape guide. Report the local outline and implementation artifact paths, phase commit SHAs, and the next registered RPI workflow; do not use legacy remote links or unavailable commands from that reference.
