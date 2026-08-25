---
name: iterate-structure-outline
description: "Updates the structure-outline artifact in place from feedback. Use when phases, file changes, or validation need to change before implementation."
---

# Iterate Structure Outline

Update the existing structure-outline artifact in place. The outline turns approved decisions into thin, independently verifiable vertical implementation slices; it is not implementation work.

Precedence: structure outline > TDD > PRD > design discussion > research > ticket.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to identify the outline and available inputs.
- Read the `structure-outline` and present `research`, `design-discussion`, `prd`, `tdd`, and `ticket` artifacts with `rpi_read_artifact`. Never read `research-questions`.
- Read source files named by feedback or an artifact before changing paths, file-change views, or validation instructions.

## Process

1. If no feedback is given, ask for it. Offer phase reorganization, scope changes, answers to open questions, or added context as examples, then wait.
2. Read ticket comments and other user-named inputs when they contain feedback. Verify factual corrections against research and code. If more evidence is needed, run a foreground `rpi_start_research` fanout with 2-6 matching installed nodes: `artifact-locator`, `artifact-analyzer`, `artifact-pattern-finder`, or `artifact-web-researcher` only for needed external documentation. Do not update before the results return.
3. Update the existing outline with `rpi_update_artifact`; preserve its YAML frontmatter, format, Implementation Overview checkboxes, and completed phase state. Rework affected sections rather than adding a change log.
4. For a requested scope change, update What We Are NOT Doing, phase contents, Desired End State, and Open Questions together. Move answered questions into the applicable phase and remove them from Open Questions.
5. Keep each phase a thin vertical slice that crosses useful module boundaries and is independently verifiable. Do not create horizontal phases such as all types, then all API, then all UI, and never make a phase depend on a later phase.
6. For each revised phase, use the smallest useful visual view: a file-change tree with `├──`, `└──`, and `│` for responsibility, or a `diff` block for an existing data or API contract. Include relevant test-file changes in the same view when research found a test pattern. Explain why the shape matters, then give runnable automated verification and specific manual verification only where a person must check behavior.

## Quality Bar and Stops

- Prefer automated proof over manual steps; do not add manual checks as filler.
- Keep phases concise, clear, and sufficiently vertical to expose cross-boundary problems early.
- Stop for a conflict between feedback and approved design or code reality. State the requested change, conflicting evidence, consequence, and required user direction; do not silently change architecture or scope.
- Do not implement code, create a branch, or advance to a later workflow while iterating the outline.

## Final Response

- Load `references/structure_outline_final_answer_in_worktree.md` only when `git rev-parse --git-dir` returns a path containing `.git/worktrees/`; never suggest workspace setup in that state.
- Otherwise load `references/structure_outline_final_answer.md` after the revised outline is ready for review.
- Treat the selected local reference as concise wording guidance only. Report the Pi manifest-relative outline path, revised phase list, and next registered RPI workflow; do not use legacy paths, remote links, or unavailable commands from it.
