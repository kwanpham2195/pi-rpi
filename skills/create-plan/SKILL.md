---
name: create-plan
description: Converts the structure outline into a detailed implementation plan with exact code shapes and runnable verification. Use before phased implementation when a detailed plan is wanted (plan is optional on top of the outline).
---

# Create Plan

Convert the outline phases into a detailed implementation plan. The plan is the "function definitions": exact code shapes, runnable automated verification, and manual verification only when justified.

Precedence: plan > structure outline > TDD > PRD > design discussion > research > ticket.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read the `structure-outline` artifact and its inputs with `rpi_read_artifact`.

## Process

1. Read all task artifacts fully, plus the relevant source files named by the outline.
2. Create the artifact: `rpi_create_artifact` with type `plan`, description `<topic>`, content from the `artifact-plan` template.
3. For each outline phase, write:
   - Overview of what lands.
   - Changes Required, grouped by component/file group, with exact code shapes and test code per researched patterns.
   - Success Criteria: Automated Verification (runnable commands with expected results) and Manual Verification (human steps, only when justified).
4. Preserve the outline's vertical-slice and independence rules; never introduce a phase that depends on a later one.
5. Keep the Implementation Overview checkbox list so implementation can resume from the first unchecked phase.

## Final response

Report the plan path and the phase count.
