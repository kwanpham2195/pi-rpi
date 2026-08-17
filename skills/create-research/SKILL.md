---
name: create-research
description: "Runs the research fanout and writes the research artifact for the active task. Use when a task needs current-state codebase research with citations and testing patterns."
---

# Create Research

Document the codebase as it is today, answering the research-questions artifact. No recommendations, no root-cause analysis, no future enhancements unless the user asks.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read the `research-questions` artifact with `rpi_read_artifact`. Never read the ticket; research must stay objective about the current code.
- If several research-questions artifacts exist, ask which to use.

## Process

1. Read any files the user mentions fully, in the main context, before spawning children.
2. Decompose the questions into 2-6 composable research areas. Group related questions into one child rather than one child per question.
3. Run the fanout in two sequential passes when the layout is unknown:
   - Pass 1: `rpi_start_research` with 2-6 `artifact-locator` nodes — where relevant files live.
   - Pass 2: on the located paths, `rpi_start_research` with `artifact-analyzer` (how selected code behaves, file:line citations), `artifact-pattern-finder` (existing implementation and test patterns), and `artifact-web-researcher` (external docs, only when needed; children must return links).
   When the layout is already known, a single parallel fanout over analyzers/pattern-finders is fine. Provide one task string per node.
4. Wait for all children to complete (the tool waits). Synthesize with file:line citations, prioritizing live code as the primary source.
5. Create the artifact: `rpi_create_artifact` with type `research`, description `<topic>`, content from the `artifact-research` template. Story-style: headers state takeaways, not topics; visuals (tables, mermaid, call-stack trees, file trees) beside the prose; testing patterns under each findings section.
6. If open questions remain, do at most one additional research pass, then fold answers into the document in place with `rpi_update_artifact`.

## Final response

Report the artifact path, key findings, and any open questions.
