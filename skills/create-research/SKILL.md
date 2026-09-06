---
name: create-research
description: "Runs a research fanout and writes a current-state research document with citations and testing patterns."
---

# Create Research

Document the codebase as it is today, answering the available research questions. No recommendations, root-cause analysis, or future enhancements unless the user asks.

## Setup

- **RPI mode:** Only when an active RPI task is already available, use `rpi_list_artifacts` and `rpi_read_artifact` for its research questions, then persist with RPI artifact tools.
- **Generic mode:** Use user-provided research questions, context, and named files. Do not create or select an RPI task and do not call an RPI tool to discover one. Return the document in chat, writing it only to an explicitly user-named path.
- If no usable research question or area is available, ask for one.

## Process

1. Read files the user names fully before starting a research fanout.
2. Decompose the questions into 2-6 composable research areas. Group related questions rather than using one child per question. Record the areas, relevant directories, and unresolved connections.
3. Run the fanout in two sequential passes when the layout is unknown: first locate relevant files, then analyze behavior and test patterns. In RPI mode, use `rpi_start_research` with 2-6 matching `artifact-locator`, `artifact-analyzer`, `artifact-pattern-finder`, and only-needed `artifact-web-researcher` nodes. In generic mode, use available foreground read-only research or analysis tools. Wait for all results before synthesis.
4. Prioritize live code as the source of truth, connect related findings, cite behavior with file:line ranges, and include returned web links.
5. Load `references/research_template.md` for the canonical document shape before drafting.
6. Write a self-contained current-state document, not an answer list or file index:
   - Use takeaway headers, concept-first prose, concise paragraphs, and nearby tables, diagrams, trees, contracts, or pseudocode when useful.
   - Keep a comprehensive grouped Code References section that states whether coverage is exhaustive or selective.
   - Add testing locations, approach, mocks, and fixtures under every findings section; state explicitly when no tests exist.
   - Do not recommend changes, diagnose root causes, critique implementation, or describe future work unless the user explicitly asks.
7. If open investigative questions remain, run at most one additional targeted pass. Fold resolved answers into affected sections rather than appending a research log. Leave genuine unanswered questions in Open Questions.
8. In RPI mode, create `research` with `rpi_create_artifact`, description `<topic>`, and `dependsOn: ["research-questions"]`; use `rpi_update_artifact` for later changes. In generic mode, deliver the completed document in chat or write it to the explicitly named path.

## Final Response

Load `references/research_final_answer.md` as concise wording guidance. In RPI mode, report the artifact path, key findings, and open questions. In generic mode, report the user-named output path when written, otherwise state that the document was delivered in chat; include key findings and open questions without promising a manifest-relative path or an RPI next stage.
