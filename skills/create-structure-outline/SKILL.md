---
name: create-structure-outline
description: "Converts research and design decisions into independently verifiable vertical implementation slices. Use after design discussion (rpi flow) or TDD (prd flow), before the detailed plan."
---

# Create Structure Outline

Turn decisions into thin, vertical, independently verifiable implementation slices. The outline defines slice intent and proof without prescribing exact code.

Precedence: structure outline > TDD > PRD > design discussion > research > ticket.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`). Task documents are managed under `.pi/artifacts/<task-slug>`; use manifest tools, not direct file mutation.
- Use `rpi_list_artifacts`, then read the `research`, `design-discussion`, `prd`, and `tdd` artifacts that exist with `rpi_read_artifact`. Read them fully, plus relevant source files they name. Never read research-questions.
- If no usable design input exists, ask which local artifact or user-provided context should drive the outline.

## Process

1. Read all inputs fully in the main context. When a task artifact or user input names a source path, read the named source before deciding its role in a phase.
2. Optionally run a foreground `rpi_start_research` fanout with 2-6 `artifact-locator`, `artifact-analyzer`, or `artifact-pattern-finder` nodes to ground the slice file changes in the real layout. Do not continue until its results return.
3. Before drafting, load `skills/create-structure-outline/references/show-me.md` for visual conventions and `skills/create-structure-outline/references/structure_outline_template.md` for document shape. Use them as guidance; the manifest artifact path returned by Pi replaces legacy storage and permalink placeholders.
4. Create the artifact: `rpi_create_artifact` with type `structure-outline`, description `<topic>`, and one flow-specific dependency: `dependsOn: ["design-discussion"]` for rpi or `dependsOn: ["tdd"]` for prd.
5. Write phases as thin vertical slices that cross module boundaries (schema + API + UI + tests per slice). Rules:
   - Each phase is independently verifiable.
   - No horizontal phases (e.g. "all migrations", "all UI").
   - No phase depends on a later phase.
   - Prefer automated proof over manual steps; do not suggest a manual check when an existing command or test can prove it.
6. Per phase, lead with a visual view of the shape, not a prose file list:
   - Use a file-change tree (`├──`, `└──`, `│` glyphs — no ASCII substitutes) when file ownership is the thing to explain.
   - Use a `diff` block for changes to an existing data structure, schema, or API contract; use a plain code block to show the complete target shape when it is new or mostly new.
   - Pick the smallest set of views that explains the phase — not every phase needs both a tree and a diff block.
   - Add a short paragraph before or after each view explaining why the shape matters and how it connects to the rest of the phase.
   - Include test-file changes in the same tree/diff view when research found existing test patterns (e.g. `+ foo.test.ts  # covers the new behavior`), rather than as a separate prose list.
   - Close each phase with a Validation section: Automated Verification (runnable commands) plus Manual Verification (human steps, only when justified).
7. Add the Implementation Overview checkbox list near the top (`- [ ] Phase N: <Title>`), Desired End State, and Open Questions when questions remain.
8. When the user corrects the outline, treat it as a document update, not implementation. Read the named sources and verify factual corrections with `rpi_start_research` when needed, then rework the affected sections with `rpi_update_artifact` rather than appending a change log.

## Final response

Determine the workspace state with `git rev-parse --git-dir`. Load `skills/create-structure-outline/references/structure_outline_final_answer_in_worktree.md` only when its result contains `.git/worktrees/`; otherwise load `skills/create-structure-outline/references/structure_outline_final_answer.md`. Follow the selected next-step format, replace legacy remote links with the local path returned by `rpi_create_artifact`, and report the phase list. Never suggest workspace setup when already in a worktree.
