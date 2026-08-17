---
name: iterate-research-questions
description: "Updates the research-questions artifact in place from user feedback. Use when the user wants to change, add, or remove research questions for the active task."
---

# Iterate Research Questions

Update the existing research-questions artifact in place. No new artifact.

## Setup

- Ensure the active task is selected (`rpi_get_task_context` or `/rpi-task`).
- Read the current `research-questions` artifact with `rpi_read_artifact`.

## Process

1. Ask for feedback if none is given: what to change, add, or remove.
2. Apply the changes: edit the questions while preserving the Key Context Pointers verbatim and keeping 2-8 neutral questions with no task-intent leakage.
3. Update in place: `rpi_update_artifact` with artifactId `research-questions` and the full revised content.

## Final response

Confirm the updated artifact and summarize what changed.
