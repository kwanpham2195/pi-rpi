---
name: create-research-questions
description: "Creates the research-questions artifact for the active task from the ticket and collateral. Use at the start of an rpi or prd flow task to define neutral, current-state questions before research begins."
---

# Create Research Questions

Use only when the user explicitly invokes this skill. Create a query plan that helps later research describe the current codebase, dependencies, and relevant external behavior. Do not propose a solution.

## Setup

- Create or select the task first so the `ticket` artifact exists: use `rpi_create_task` (slug, title, flow, ticketBody) or the `/rpi-new` command; then use `rpi_get_task_context` to select it. Use flow `prd` for a PRD-flow task.
- Read the `ticket` artifact fully with `rpi_read_artifact` (artifactId `ticket`). Read each collateral artifact or local file explicitly named by the user, fully. Do not read other task artifacts unless the user requests them.
- Preserve verbatim Key Context Pointers from the ticket and collateral: URLs, documents, repositories, packages, dependencies, file paths, and directories.

## Process

1. Read the ticket, named collateral, and their context pointers in the main context before starting research.
2. If the context is not enough to write grounded questions, use `rpi_start_research` with 2-6 matching registered research nodes and task strings. Use:
   - `artifact-locator` to find related implementation, tests, configuration, and entry points.
   - `artifact-analyzer` to document present behavior and data flow.
   - `artifact-pattern-finder` to find existing implementation and test patterns.
   - `artifact-web-researcher` only when a dependency or external documentation needs investigation.
   Synthesize the returned findings; do not treat them as implementation recommendations.
3. Load the registered `artifact-research-questions` prompt before creating content. Load the local sibling `references/research_questions_template.md` only when its fuller question layout or Key Context Pointers examples are needed. It is a formatting aid, not an artifact path or tool contract.
4. Write 2-8 questions, scaled to the task. Each question must ask what exists, where it lives, how it works, how modules interact, relevant constraints or edge cases, and how it is tested. Include concrete pointers where they make research faster.
5. Keep questions neutral and descriptive:
   - Never leak task intent or prescribe a change. Write “How does X work today?” rather than “How should we build X?”
   - Do not ask what the codebase needs, or suggest improvements, unless the user explicitly requests that scope.
   - Include libraries and dependencies when their capabilities or behavior must be understood.
   - If frontend or visual work may be involved, include questions about the product design system, component library, colors, typography, spacing, borders, shadows, and theming.
6. Create the artifact with `rpi_create_artifact`: type `research-questions`, description `<topic>`, `dependsOn: []`, and content based on `artifact-research-questions`. The tool returns the Pi manifest-relative artifact path.

## Quality Bar

- The question set documents only the current state and points the research phase to high-signal evidence.
- Key Context Pointers preserve supplied values verbatim and are omitted only when none exist.
- Questions are specific enough to direct research but contain no proposed architecture or implementation direction.

## Final Response

Load `references/research_questions_final_answer.md` only to preserve its concise review-and-next-step structure. Replace any unavailable command or external link in that reference with the Pi artifact path returned by `rpi_create_artifact` and the registered RPI workflow.

Report the artifact path. State that the questions are a query plan, not questions the user must answer, and ask the user to review or adjust them before research begins. Do not add a summary beyond that response.
