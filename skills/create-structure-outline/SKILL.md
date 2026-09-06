---
name: create-structure-outline
description: "Converts available research and design decisions into independently verifiable vertical implementation slices."
---

# Create Structure Outline

Turn decisions into thin, vertical, independently verifiable implementation slices. The outline defines slice intent and proof without prescribing exact code.

## Setup

- **RPI mode:** Only when an active RPI task is already available, inspect task artifacts with `rpi_list_artifacts` and `rpi_read_artifact`, then persist the outline with RPI artifact tools.
- **Generic mode:** Use user-provided design inputs, research, and named files. Do not create or select an RPI task and do not call an RPI tool to discover one. Return the document in chat, writing it only to an explicitly user-named path.
- Read all available design inputs and source files they name. If no usable design input exists, ask which local artifact or user-provided context should drive the outline.

## Process

1. Read all inputs fully before deciding a phase's role.
2. When real layout evidence is needed, run a foreground read-only research pass. In RPI mode, use `rpi_start_research` with 2-6 `artifact-locator`, `artifact-analyzer`, or `artifact-pattern-finder` nodes. In generic mode, use available foreground read-only research or analysis tools. Do not draft from unverified assumptions.
3. Load `references/show-me.md` for visual conventions and `references/structure_outline_template.md` for the canonical document shape.
4. Write phases as thin vertical slices that cross module boundaries. Each phase must be independently verifiable, may not be horizontal work such as all migrations or all UI, and may not depend on a later phase.
5. For every phase, lead with the smallest useful visual view:
   - Use a file-change tree (`├──`, `└──`, `│`) when file ownership matters.
   - Use a `diff` block for an existing data structure, schema, or API contract; use a plain code block for a complete new or mostly new target shape.
   - Include test-file changes in the same view when research found a test pattern.
   - Explain why the shape matters, then close with runnable Automated Verification and specific Manual Verification only where a person must check behavior.
6. Add the Implementation Overview checkbox list near the top (`- [ ] Phase N: <Title>`), Desired End State, and Open Questions when questions remain.
7. For later user corrections, verify named sources before changing paths, file views, or validation instructions. In RPI mode, use `rpi_update_artifact`; in generic mode, revise the delivered document or explicitly named file rather than adding a change log.
8. In RPI mode, create `structure-outline` with `rpi_create_artifact`, description `<topic>`, and the active flow's approved design dependency. In generic mode, deliver the completed outline in chat or write it to the explicitly named path.

## Final Response

Use `references/structure_outline_final_answer.md`, or `references/structure_outline_final_answer_in_worktree.md` when its worktree condition applies, only as concise wording guidance. In RPI mode, report the artifact path and phase list. In generic mode, report the user-named output path when written, otherwise state that the outline was delivered in chat; report the phase list without promising a manifest-relative path or an RPI next stage.
