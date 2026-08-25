---
name: create-plan
description: "Converts the structure outline into a detailed implementation plan with exact code shapes and runnable verification. Use before phased implementation when a detailed plan is wanted (plan is optional on top of the outline)."
---

# Create Plan

Use only when the user explicitly invokes this skill. Convert the structure outline into a complete implementation plan with exact code changes, runnable automated verification, and manual verification only when justified.

Precedence: plan > structure outline > TDD > PRD > design discussion > research > ticket.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`.
- Read the `structure-outline` and its required inputs fully with `rpi_read_artifact`.
- Read `design-discussion` for an rpi flow, or `tdd` and `prd` for a prd flow, plus `research` and `ticket`. Never read `research-questions`.
- Read relevant source files fully when the outline, research, or design names them. Use this context to give exact code examples and test changes, not generic descriptions.

## Process

1. Load the registered `artifact-plan` prompt before creating content. Load `references/plan_template.md` only when its expanded phase, code-example, or verification layout is needed. It is a formatting aid, not an artifact path or tool contract.
2. Create the artifact with `rpi_create_artifact`: type `plan`, description `<topic>`, `dependsOn: ["structure-outline"]`, and content based on `artifact-plan`.
3. Write a coherent plan with Overview, Current State Analysis, Key Discoveries with source locations, Desired End State, out-of-scope work, and Implementation Approach.
4. Convert every outline phase into a detailed plan phase. Each phase must be an independently testable vertical slice and must not depend on a later phase.
5. For every phase, include:
   - An Overview of what lands.
   - Changes Required, grouped by component or file group.
   - Exact file paths, code shapes, placement guidance, and concrete code examples rather than only descriptions.
   - Test additions or updates that follow patterns documented by research.
   - Success Criteria with runnable Automated Verification commands and their expected results.
   - Manual Verification steps only where a person must verify behavior that automation cannot prove. Make each step specific and actionable. When manual verification is present, state that implementation pauses after automated verification for user confirmation before a later phase.
6. Keep the phase checkbox list in the Implementation Overview so implementation can resume at the first unchecked phase. Do not mark a phase complete while writing the plan.
7. Preserve the outline’s sequencing, independence, and scope. Do not add unresearched work or remove an intentional outline phase.

## Quality Bar

- The plan is detailed enough that an implementer can make each exact change without rediscovering the architecture.
- Every claimed test command is runnable in the target repository and has an expected result.
- Test code follows the existing tested pattern when research found one.
- Manual verification appears only when it is necessary, never as filler.
- When documents conflict, this plan supersedes its inputs.

## Final Response

- Load `references/plan_final_answer.md` only when the plan is complete and needs the standard concise completion response.
- Do not load `references/plan_final_answer_in_worktree.md` or `references/plan_final_answer_disabled.md`: their upstream conditions have no Pi manifest field or registered tool in this runtime. Do not create, switch, or modify a branch as part of this skill.
- Treat the loaded local reference as wording guidance only. Report the Pi manifest-relative path returned by `rpi_create_artifact`; do not use unavailable commands, external links, or non-Pi artifact paths from the reference.

Report the plan path and phase count. State the next registered RPI workflow stage based on the active task manifest, without performing it. Do not add a separate summary.
