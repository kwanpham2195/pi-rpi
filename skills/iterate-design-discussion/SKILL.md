---
name: iterate-design-discussion
description: "Updates the design-discussion artifact in place from user decisions or corrections. Use when the user answers a design question or corrects the design."
---

# Iterate Design Discussion

Update the existing design-discussion artifact in place as decisions land or corrections arrive. The user resolves decisions; the agent does not resolve one on its own.

Precedence: design discussion > research > ticket.

## Setup

- Select the active task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to confirm the available artifacts.
- Read the current `design-discussion`, `research`, and `ticket` artifacts with `rpi_read_artifact`. Read other task artifacts or source files only when they are needed for the stated feedback. Never read `research-questions`.

## Feedback and Decision Loop

1. If no feedback is given, ask: “I'm ready to iterate on the design discussion. What feedback or changes would you like me to incorporate?” Then wait.
2. Never accept a correction blindly. Read the named sources and verify facts against research or code. When existing evidence is insufficient, use `rpi_start_research` with 2-6 matching installed nodes: `artifact-locator`, `artifact-analyzer`, and/or `artifact-pattern-finder`; use `artifact-web-researcher` only for necessary external documentation. Incorporate the factual findings before presenting options or updating the artifact.
3. For an open decision, state one decision, its options, tradeoffs, and recommendation. Keep it open through clarification or pushback. Do not update the artifact until the user clearly resolves it.
4. After resolution, update the document with `rpi_update_artifact`:
   - Move the answered question to Resolved Design Questions with the selected option, rationale, and rejected options.
   - Add genuinely new questions to open Design Decisions.
   - Rework Current State, Desired End State, out-of-scope behavior, architecture views, patterns, and testing guidance that the decision affects.
   - Keep a coherent current design, never a Q&A log or decision changelog.
5. After each resolved update, stop and ask what to work on next. Do not process another independent decision without user direction.

## Content and Quality Bar

- Describe requested behavior, current constraints, and the proposed end-state architecture without inventing codebase facts.
- Use before/after diagrams, concise pseudocode, types, or contracts when they explain a design choice better than prose.
- Keep pattern guidance grounded in research, with source locations and concise multiline examples when available.
- All decisions remain open until explicit user feedback resolves them. A recommendation is not a resolution.
- The design discussion supersedes conflicting research and ticket content.

## Final Response

- When one or more design decisions remain open, load `references/design_discussion_final_answer.md` for the concise review-and-decision response shape.
- Only after the user resolves every design decision, load `references/design_discussion_final_answer_resolved.md` for the completion response shape.
- Treat either local reference as wording guidance only. Report the Pi manifest-relative design-discussion path and remaining decisions; replace legacy commands, paths, and links in the reference with the appropriate registered RPI workflow or local artifact path.
