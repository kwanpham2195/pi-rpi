---
name: create-design-discussion
description: Turns research and the ticket into an explicit user-decided design document. Use after research when the task flow is rpi and design decisions must be resolved by the user.
---

# Create Design Discussion

Convert the research and ticket into explicit design decisions. The user resolves every question; the agent never self-resolves.

Precedence for this document: design discussion > research > ticket.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read the `research` artifact and the `ticket` artifact fully with `rpi_read_artifact`. Never read research-questions.

## Process

1. Read the inputs fully in the main context before spawning any research children.
2. Optionally run `rpi_start_research` (artifact-locator/analyzer/pattern-finder) if a decision depends on codebase facts.
3. Create the artifact: `rpi_create_artifact` with type `design-discussion`, description `<topic>`, content from the `artifact-design-discussion` template.
4. Fill Current State (from research) and Desired End State, then a Proposed Architecture with before/after views, diagrams, or pseudocode.
5. For each design decision, present options with tradeoffs and a recommendation, and ask the user to decide. Keep every question open until the user answers; do not mark anything resolved without the user.
6. Move answered decisions to Resolved with rationale and rejected options as they land, and re-paint the document.

## Final response

Report the artifact path and the list of decisions still awaiting the user.
