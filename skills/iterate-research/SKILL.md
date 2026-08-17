---
name: iterate-research
description: "Updates the research artifact in place from corrections or new findings. Use when research needs to reflect changed understanding of the codebase."
---

# Iterate Research

Update the existing research artifact in place. No new artifact, no append-only changelog.

## Setup

- Ensure the active task is selected.
- Read the current `research` artifact with `rpi_read_artifact`. If several exist, ask which.

## Process

1. Ask for the feedback if none is given.
2. For corrections: verify the facts against the code first (read the cited files), then edit.
3. For new research: run `rpi_start_research` with the needed nodes (web research only if the user explicitly asks).
4. Update the document in place with `rpi_update_artifact`, reworking the affected sections rather than appending. Keep the story style and citations current.

## Final response

Summarize what changed and any remaining open questions.
