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
5. Per phase: overview, specific file changes, test-file changes per researched patterns, and a Validation section with Automated Verification (runnable commands) plus Manual Verification (human steps, only when justified).
6. Add the Implementation Overview checkbox list (`- [ ] Phase N: <Title>`).

## Final response

Report the outline path and the phase list.
