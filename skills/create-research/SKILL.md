---
name: create-research
description: "Runs the research fanout and writes the research artifact for the active task. Use when a task needs current-state codebase research with citations and testing patterns."
---

# Create Research

Document the codebase as it is today, answering the research-questions artifact. No recommendations, no root-cause analysis, no future enhancements unless the user asks.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`). Task documents are managed under `.pi/artifacts/<task-slug>`; use manifest tools, not direct file mutation.
- Use `rpi_list_artifacts`, then read the selected `research-questions` artifact fully with `rpi_read_artifact`. Never read the ticket or other task artifacts unless the user explicitly names one; research must stay objective about the current code.
- If several active research-questions artifacts exist, ask which to use before reading one. If none exists and the user did not provide a research area, ask for the research question.

## Process

1. Read any files the user mentions fully, in the main context, before spawning children.
2. Decompose the questions into 2-6 composable research areas. Group related questions into one child rather than one child per question. Make a short research plan that records the areas, relevant directories, and unresolved connections.
3. Run the fanout in two sequential passes when the layout is unknown:
   - Pass 1: `rpi_start_research` with 2-6 `artifact-locator` nodes — where relevant files live.
   - Pass 2: on the located paths, `rpi_start_research` with `artifact-analyzer` (how selected code behaves, file:line citations), `artifact-pattern-finder` (existing implementation and test patterns), and `artifact-web-researcher` (external docs, only when needed; children must return links).
   When the layout is already known, a single parallel fanout over analyzers/pattern-finders is fine. Provide one task string per node.
4. Wait for every child result before synthesis; `rpi_start_research` waits for its fanout. Prioritize live code as the source of truth, connect related findings, cite each behavior with file:line ranges, and include web links returned by web research.
5. Before creating the document, load `skills/create-research/references/research_template.md`. Use it as the document-shape checklist, adapting its legacy storage and permalink placeholders to the local artifact path returned by Pi.
6. Create the artifact with `rpi_create_artifact`: type `research`, description `<topic>`, `dependsOn: ["research-questions"]`, and content from the registered `artifact-research` prompt. The document is a self-contained story of the current codebase, not an answer list or file index:
   - Use takeaway headers, concept-first prose, concise paragraphs, and nearby visuals. Choose tables, Mermaid, call-stack trees, file trees, component trees, contracts, and pseudocode when each makes the current shape clearer.
   - Keep a comprehensive, grouped Code References section that states whether its coverage is exhaustive or selective.
   - Add testing locations, approach, mocks, and fixtures under every findings section; state explicitly when no tests exist.
   - Do not recommend changes, diagnose root causes, critique the implementation, or describe future work unless the user explicitly asks.
7. If open investigative questions remain, run at most one additional targeted `rpi_start_research` pass. Fold resolved answers into the affected sections with `rpi_update_artifact`; do not append a research log. Leave genuine unanswered questions in Open Questions.

## Final response

Before responding, load `skills/create-research/references/research_final_answer.md`. Follow its next-step and open-question format, but report the local path returned by `rpi_create_artifact` rather than an unavailable remote permalink. Include the artifact path, key findings, and any open questions; when open questions remain, state their count and offer one additional targeted research pass.
