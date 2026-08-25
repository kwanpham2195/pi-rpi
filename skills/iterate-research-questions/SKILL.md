---
name: iterate-research-questions
description: "Updates the research-questions artifact in place from user feedback. Use when the user wants to change, add, or remove research questions for the active task."
---

# Iterate Research Questions

Update the existing research-questions artifact in place. Do not create a new artifact.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to confirm the active `research-questions` artifact.
- Read it fully with `rpi_read_artifact`. Read a ticket or other collateral artifact only when the user explicitly names it as feedback.

## Process

1. If no feedback is given, ask what to change, add, or remove, then wait.
2. Update the artifact with `rpi_update_artifact`, preserving its YAML frontmatter, format, and every existing Key Context Pointers entry verbatim. Add a new pointer only when user feedback surfaces it.
3. Address each requested change without turning the document into a task plan. Keep 3-8 neutral questions unless the task complexity clearly requires fewer or more; questions must ask only how the codebase works now, where it lives, its contracts, patterns, constraints, or edge cases.
4. Do not leak task intent, proposed changes, recommendations, or “how should we” language into a question. Keep research objective.
5. When frontend or visual work may be involved, include a question about the active design system or component library and its colors, typography, spacing, borders, shadows, and theming patterns.

## Final Response

Load `references/research_questions_final_answer.md` only after the revised questions artifact is updated and ready for research. Use it as concise wording guidance only. Report the Pi manifest-relative artifact path and the next registered RPI research workflow; do not use legacy paths, remote links, or unavailable commands from the reference.
