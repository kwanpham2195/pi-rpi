---
name: iterate-plan
description: "Updates the plan artifact in place from feedback. Use when code shapes, phases, or verification need to change before or during implementation."
---

# Iterate Plan

Update the existing plan artifact in place. The plan remains the detailed authority for implementation.

Precedence: plan > structure outline > TDD > PRD > design discussion > research > ticket.

## Setup

- Select the active task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to identify the plan and its inputs.
- Read the plan and available structure outline, TDD or design discussion, research, and ticket with `rpi_read_artifact`. Never read `research-questions` unless the user explicitly asks.
- Read source files named by the feedback or artifacts before changing code examples, paths, or verification commands.

## Process

1. If no feedback is given, ask what changed and wait.
2. Read ticket comments or other user-named inputs when they contain feedback. Verify every correction against the source and existing tests; do not accept it blindly. If evidence is insufficient, use `rpi_start_research` with 2-6 matching installed research nodes before editing.
3. Update the plan in place with `rpi_update_artifact`. Keep its frontmatter, implementation-overview checkboxes, and completed phase state intact. Rework affected sections rather than appending a change record.
4. When phase changes are requested, reorganize the phases without creating horizontal work or a phase that depends on a later phase. Preserve intentional scope unless the user directs a scope change.
5. Keep each phase independently testable. For every changed phase, give exact file paths, accurate and complete code shapes, runnable automated verification with expected results, and manual verification only when automation cannot prove the behavior.
6. Pause for human confirmation between implementation phases when the plan contains a manual gate. Do not mark a phase complete while merely revising the plan.

## Quality Bar

- An implementer can make the exact changes without rediscovering the architecture.
- Code examples and file paths match the present codebase.
- Success criteria are actionable; stated commands are runnable in the target repository.
- The plan supersedes conflicting input artifacts.

## Final Response

- Load `references/plan_final_answer.md` only when the revised plan is complete and the standard Pi completion response is needed.
- Load `references/plan_final_answer_in_worktree.md` only when `git rev-parse --git-dir` shows `.git/worktrees/`; do not suggest workspace setup in that state.
- `references/plan_final_answer_disabled.md` applies only to an upstream disabled-workspace mode. Do not load it in Pi because no active-task manifest field or registered RPI workflow represents that mode, and do not create or switch branches.
- Treat a loaded reference as wording guidance only. Report the Pi manifest-relative plan path, revised phase list, and next registered RPI workflow stage; do not use legacy paths, remote links, or unavailable commands from it.
