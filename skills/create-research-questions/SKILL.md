---
name: create-research-questions
description: "Creates the research-questions artifact for the active task from the ticket and collateral. Use at the start of an rpi or prd flow task to define neutral, current-state questions before research begins."
---

# Create Research Questions

Use when a task needs its research-questions artifact: the neutral questions the research will answer.

## Setup

- Create or select the task first so the `ticket` artifact exists: use `rpi_create_task` (slug, title, flow, ticketBody) or the `/rpi-new` wizard; then `rpi_get_task_context` to select it. For a prd-flow task, select flow `prd` here.
- Read the ticket artifact with `rpi_read_artifact` (artifactId `ticket`).

## Process

1. Read the ticket and any collateral the user mentions, fully.
2. Capture Key Context Pointers verbatim: ticket URL, repo, dependencies, relevant paths.
3. If the area is unfamiliar, optionally run a light `rpi_start_research` fanout with 2 nodes (e.g. two `artifact-locator` tasks over different areas) to ground the questions in what exists.
4. Write 2-8 neutral questions. Rules:
   - Each asks what exists, where it lives, how it works, and how it is tested.
   - No task-intent leakage. Never phrase as "how would we build X"; phrase as "what does X do today".
   - If any frontend involvement, include design-system questions.
5. Create the artifact: `rpi_create_artifact` with type `research-questions`, description `<topic>`, content from the `artifact-research-questions` template.

## Final response

Report the artifact path and ask the user to review or adjust the questions before research begins.
