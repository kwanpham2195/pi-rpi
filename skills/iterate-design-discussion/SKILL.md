---
name: iterate-design-discussion
description: Updates the design-discussion artifact in place from user decisions or corrections. Use when the user answers a design question or corrects the design.
---

# Iterate Design Discussion

Update the existing design-discussion artifact in place as decisions land or corrections arrive.

## Setup

- Ensure the active task is selected.
- Read the current `design-discussion`, `research`, and `ticket` artifacts with `rpi_read_artifact`.

## Process

1. If no feedback is given, ask what changed.
2. Never accept a correction blindly: verify facts against research or the code, spawning research children if needed.
3. Update the document in place with `rpi_update_artifact`:
   - Move answered questions to Resolved with rationale and rejected options.
   - Add new open questions as they arise.
   - Re-paint affected sections; never keep a Q&A log.
4. Stop and ask what is next after each update.

## Final response

Confirm the update and list remaining open decisions.
