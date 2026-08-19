---
name: create-structure-outline
description: "Converts research and design decisions into independently verifiable vertical implementation slices. Use after design discussion (rpi flow) or TDD (prd flow), before the detailed plan."
---

# Create Structure Outline

Turn decisions into thin, vertical, independently verifiable implementation slices. The outline is the "c header files" of the task.

Precedence: structure outline > TDD > PRD > design discussion > research > ticket.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read the `research`, `design-discussion`, `prd`, and `tdd` artifacts (whichever exist) with `rpi_read_artifact`. Never read research-questions.

## Process

1. Read all inputs fully in the main context.
2. Optionally run a foreground research fanout (locator/analyzer/pattern-finder) to ground the slice file changes in the real layout. Research children run in the foreground, never background.
3. Create the artifact: `rpi_create_artifact` with type `structure-outline`, description `<topic>`, content from the `artifact-structure-outline` template.
4. Write phases as thin vertical slices that cross module boundaries (schema + API + UI + tests per slice). Rules:
   - Each phase is independently verifiable.
   - No horizontal phases (e.g. "all migrations", "all UI").
   - No phase depends on a later phase.
5. Per phase, lead with a visual view of the shape, not a prose file list:
   - Use a file-change tree (`├──`, `└──`, `│` glyphs — no ASCII substitutes) when file ownership is the thing to explain.
   - Use a `diff` block for changes to an existing data structure, schema, or API contract; use a plain code block to show the complete target shape when it is new or mostly new.
   - Pick the smallest set of views that explains the phase — not every phase needs both a tree and a diff block.
   - Add a short paragraph before or after each view explaining why the shape matters and how it connects to the rest of the phase.
   - Include test-file changes in the same tree/diff view when research found existing test patterns (e.g. `+ foo.test.ts  # covers the new behavior`), rather than as a separate prose list.
   - Close each phase with a Validation section: Automated Verification (runnable commands) plus Manual Verification (human steps, only when justified).
6. Add the Implementation Overview checkbox list (`- [ ] Phase N: <Title>`).

## Final response

Report the outline path and the phase list.
