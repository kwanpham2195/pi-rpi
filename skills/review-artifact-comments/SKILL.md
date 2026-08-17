---
name: review-artifact-comments
description: Reviews and responds to feedback on task artifacts. Use when the user points to feedback on a document or asks to address review comments on an artifact.
---

# Review Artifact Comments

Process feedback on a task artifact. Local-first: feedback arrives in the conversation or as inline comments; there is no threaded comment store in v1.

## Setup

- Ensure the active task is selected.
- Identify the artifact under review (from the user or the conversation).

## Process

1. Read the artifact with `rpi_read_artifact`.
2. Read the feedback: inline `<comment>` blocks the user pastes, or the conversation text.
3. Ask the user how to proceed before editing, offering concise options:
   - Update the artifact to address the feedback
   - Update and mark the artifact in-review
   - Research first, then reply
4. Follow the instruction, one comment at a time.
5. Update the artifact in place with `rpi_update_artifact`. If feedback is resolved, propose marking the artifact approved via `rpi_set_artifact_status` or `/rpi-approve`.

## Rules

- Never resolve or delete feedback without explicit instruction.
- Keep the change scoped to the comment; re-paint the affected section, not the whole document.

## Final response

Report each comment, its disposition, and the artifact status.
