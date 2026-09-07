---
name: implement-plan
description: "Orchestrates phased implementation of the plan using one code-only implementer agent per phase with parent-owned verification and human gates. Use after the plan is approved; the plan is the source of truth for each phase."
---

# Implement Plan

Each phase is one observable behavior with one focused automated verification group and one writer; split unrelated subsystem work before launching the child.

Orchestrate phased implementation of the plan. You are the parent orchestrator: launch one code-only implementer for one phase, review its diff, run the missing checks, wait for the human gate, and commit. Never run phases in parallel or delegate a whole multi-phase plan to one run.

## Setup

1. Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to discover current artifacts and statuses.
2. Read the `plan` fully with `rpi_read_artifact`, then read the `structure-outline` and relevant inputs when needed. For a oneshot ticket task, read the approved `ticket` instead and use it as the source of truth for the single `implementation` phase. Do not read or edit artifact files directly; task artifacts live under `.pi/artifacts/` and are managed by RPI tools.
3. The plan is the source of truth for every phase. When it conflicts with an input artifact, stop and use the mismatch procedure rather than choosing a different design.
4. Identify Phase 1 or the first unchecked phase, and read its automated and manual verification requirements before launching an implementer.

## Phase Protocol

For each phase, starting with Phase 1 or the first unchecked:

1. Launch exactly one implementer with `rpi_implement_phase`: agent `artifact-implementer` and a short `phaseTask` that names only that phase. The plan source uses a `## Phase N: title` Markdown heading; set `phaseId` to the heading text `Phase N: title`, without leading `##` and without a completion marker. For a oneshot task, use an approved ticket and set `phaseId` to exactly `implementation`. The extension reloads the active manifest, requires the approved plan or ticket, and gives the child the exact absolute task directory and source path. Do not put hidden task selection or artifact mutation instructions in `phaseTask`.
2. Keep the returned `runId`. Review the complete result and the actual code diff for completed work, deviations, failed or missing checks, and requested manual steps. The child writes code and reports evidence only; it does not update artifacts, wait for a human, commit, or record a receipt. If the run does not complete successfully, stop. Do not mark progress, commit, create an implementation artifact, or record a phase commit.
3. Run any automated verification the child missed, including the plan's stated focused build, test, lint, or formatting commands. Investigate and fix failures before the gate. The child should verify the focused phase behavior; the parent runs omitted checks and the final full repository gate after all phase diffs stabilize.
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
7. Create or update the `implementation` artifact through `rpi_create_artifact` or `rpi_update_artifact` after the verified work. Set `dependsOn: ["ticket"]` for oneshot ticket tasks and `dependsOn: ["plan"]` for plan-backed tasks. The parent owns this artifact mutation.
8. Call `rpi_record_phase_commit` only after the human gate and Git commit, with `phaseId`, the returned `runId`, and the verified commit SHA.
9. For plan-backed tasks, the parent must update the authoritative `plan` through `rpi_update_artifact` to mark the verified phase complete. Update its phase completion marker only after the human confirmation, code commit, and receipt above, so resumption can find the next unchecked phase. Oneshot ticket tasks have no plan marker to update.
10. Repeat for the next phase only after steps 1–9 complete. Use a separate implementer run and verification cycle for every phase.

## Stops and Mismatches

- If the plan cannot be followed, present: **Plan requirement**, **Code reality**, **Consequence**, and **Requested direction**. Wait for guidance before proceeding. Consider `iterate-plan` only when the user directs a plan update.
- When resuming, use the plan's checkboxes to select the first unchecked phase. Trust completed work unless something is inconsistent.
- Never bypass a failed automated check or the manual gate. Never create a phase receipt for an uncommitted or unverified phase.

## Final Response

After every completed phase, provide its implementation summary, automated verification results, and manual verification list. After the final phase, read the completed plan (or the ticket for a oneshot task) and load `references/implement_plan_final_answer.md` only as a concise response-shape guide. Report the local plan or ticket and implementation artifact paths, phase commit SHAs, and the next registered RPI workflow; do not use legacy remote links or unavailable commands from that reference.
