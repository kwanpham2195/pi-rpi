---
name: create-plan
description: "Converts a structure outline into a detailed implementation plan with exact code shapes and runnable verification."
---

# Create Plan

Convert the available structure outline into a complete implementation plan with exact code changes, runnable automated verification, and manual verification only when justified.

## Setup

- **RPI mode:** Only when an active RPI task is already available, read task artifacts with `rpi_read_artifact` and persist the plan with RPI artifact tools.
- **Generic mode:** Use user-provided outline, design, research, and named files. Do not create or select an RPI task and do not call an RPI tool to discover one. Return the document in chat, writing it only to an explicitly user-named path.
- Read relevant source files fully when inputs name them. Use the context for exact code examples and test changes, not generic descriptions.

## Process

1. Load `references/plan_template.md` for the canonical document shape, including expanded phase, code-example, and verification layout.
2. Write a coherent plan with Overview, Current State Analysis, Key Discoveries with source locations, Desired End State, out-of-scope work, and Implementation Approach.
3. Convert every outline phase into a detailed plan phase. Each phase must be an independently testable vertical slice and must not depend on a later phase.
4. For every phase, include:
   - An Overview of what lands.
   - Changes Required, grouped by component or file group.
   - Exact file paths, code shapes, placement guidance, and concrete code examples rather than only descriptions.
   - Test additions or updates that follow patterns documented by research.
   - Success Criteria with runnable Automated Verification commands and expected results.
   - Manual Verification only where automation cannot prove behavior. Make each step specific and actionable; when present, state that implementation pauses after automated verification for user confirmation.
5. Keep the Implementation Overview checkbox list so implementation can resume at the first unchecked phase. Do not mark a phase complete while writing the plan.
6. Preserve the outline's sequencing, independence, and scope. Do not add unresearched work or remove an intentional outline phase.
7. In RPI mode, create `plan` with `rpi_create_artifact`, description `<topic>`, and `dependsOn: ["structure-outline"]`; use `rpi_update_artifact` for later changes. In generic mode, deliver the completed plan in chat or write it to the explicitly named path.

## Quality Bar

- The plan is detailed enough that an implementer can make each exact change without rediscovering the architecture.
- Every claimed test command is runnable in the target repository and has an expected result.
- Test code follows the existing tested pattern when research found one.
- Manual verification appears only when necessary, never as filler.
- When documents conflict, this plan supersedes its inputs.

## Final Response

Load `references/plan_final_answer.md` only as concise wording guidance when the plan is complete. In RPI mode, report the artifact path and phase count. In generic mode, report the user-named output path when written, otherwise state that the plan was delivered in chat; report the phase count without promising a manifest-relative path or an RPI next stage.
