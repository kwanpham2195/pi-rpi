---
name: iterate-research
description: "Updates the research artifact in place from corrections or new findings. Use when research needs to reflect changed understanding of the codebase."
---

# Iterate Research

Update the existing research artifact in place. Document the codebase as it exists today; do not append a research log, recommend changes, diagnose root causes, or critique implementation unless the user explicitly asks.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to find `research` artifacts and their statuses.
- If several research artifacts exist, ask the user which to update before reading one. Read the selected research artifact with `rpi_read_artifact`.
- Do not read ticket, design, or other task artifacts unless the user explicitly names one. Research remains objective about the present codebase.

## Process

1. If no feedback or research area is given, ask for it and wait.
2. Read all user-named files fully before changing the research artifact. Verify corrections against current code and citations; do not accept them blindly.
3. For additional research, split the work into 2-6 related areas and use `rpi_start_research` with matching installed nodes. Start with `artifact-locator` when the layout is unknown, then use `artifact-analyzer` for behavior and file:line citations and `artifact-pattern-finder` for existing patterns and tests. Use `artifact-web-researcher` only when the user explicitly requests external research; include returned links.
4. Wait for all research results, then update the existing artifact with `rpi_update_artifact`. Rework affected sections rather than appending new findings. Perform at most one additional targeted research pass for genuine open investigative questions.
5. Keep a self-contained story: takeaway headings, concise paragraphs, nearby tables, diagrams, call-stack trees, file trees, component trees, contracts, or pseudocode when they make the current structure clearer. Cite behavior with file:line ranges and describe relevant tests or state explicitly that none exist.
6. Keep genuine unanswered items in Open Questions. Fold resolved answers into the appropriate findings section.

## Final Response

Load `references/research_final_answer.md` only after the research update is complete. Follow its concise next-step and open-question response shape, but report the Pi manifest-relative research path rather than legacy paths or remote links. State the open-question count and offer one additional targeted RPI research pass when questions remain.
