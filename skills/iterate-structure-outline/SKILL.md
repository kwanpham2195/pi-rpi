---
name: iterate-structure-outline
description: "Updates the structure-outline artifact in place from feedback. Use when phases, file changes, or validation need to change before implementation."
---

# Iterate Structure Outline

Update the existing structure-outline artifact in place.

## Setup

- Ensure the active task is selected.
- Read the current `structure-outline` artifact and its inputs with `rpi_read_artifact`.

## Process

1. Ask for feedback if none is given.
2. Verify corrections against research before applying.
3. Reorganize phases, update "What We Are NOT Doing", and fold answered open questions in.
4. Update in place with `rpi_update_artifact`. Keep the slice rules: vertical, independently verifiable, no horizontal phases.

## Final response

Confirm the update and the revised phase list.
