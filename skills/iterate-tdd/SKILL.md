---
name: iterate-tdd
description: "Updates the TDD artifact in place as technical decisions evolve. Use when the user gives feedback or corrects system or program design."
---

# Iterate TDD

Update the existing TDD artifact in place through two ordered design conversations: System Design, then Program Design. Guide the user through one decision at a time; do not resolve technical decisions autonomously.

Precedence: TDD > PRD > design discussion > research > ticket.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to identify the TDD and available inputs.
- Read the current `tdd`, `prd` when present, `design-discussion` when present, `research`, and `ticket` artifacts with `rpi_read_artifact`. Never read `research-questions`.

## Initial Choice and Decision Loop

1. If no feedback is given, ask the user to choose: provide specific feedback, continue grilling the technical design one decision at a time, or surface more technical design questions. Then wait.
2. Ask exactly one independent decision per message. Give options, tradeoffs, and a recommendation for that decision only, then wait. Clarification and pushback do not resolve it.
3. Verify corrections against named sources. If a decision needs codebase evidence, use `rpi_start_research` with 2-6 matching installed `artifact-analyzer` and/or `artifact-pattern-finder` nodes; include `artifact-locator` when paths are unknown, and `artifact-web-researcher` only for needed external documentation. Fold factual findings into the TDD and relevant research artifact before presenting options.
4. After explicit user resolution, update the TDD with `rpi_update_artifact`. Rework affected prose, diagrams, types, contracts, code-shape views, patterns, testing guidance, and earlier sections so the TDD stays cohesive rather than becoming a Q&A log.
5. After each update, stop and ask what to work on next. Offer only the next decision that unblocks the design.

## System and Program Design Rules

- System Design covers cross-component behavior: services, endpoints, queues, stores, external interfaces, data flow, control flow, and high-level contracts. Use Mermaid, concise types, endpoint shapes, and data contracts when they clarify the decision.
- Program Design covers the in-code shape: call-stack trees, component trees, file-tree diffs, dependency-injection maps, internal signatures, and pseudocode. Use concrete code-shape options when comparing alternatives.
- Use takeaway headings, short paragraphs, and place each diagram or snippet beside the prose it explains. Prefer the smallest set of views that gives the user useful leverage over the implementation.
- When product scope or UX changes, update the relevant PRD and mockup artifact with `rpi_update_artifact` before treating the technical decision as settled.
- For a new focused visual that Mermaid or text cannot explain, load `references/artifact_template.html` only for that visual, then use `rpi_create_artifact` to create a `diagram` artifact with `dependsOn: ["tdd"]`. Use realistic labels, the template visual system, and link the returned local artifact path from the TDD.

## Ordered Sign-Off Gates

1. After System Design decisions resolve, stop and ask the user to review System Design top to bottom. Incorporate corrections with `rpi_update_artifact`. Do not open Program Design until the user explicitly signs off.
2. After Program Design decisions resolve, stop and ask the user to review Program Design top to bottom. Incorporate corrections and record both approved gates in the TDD.
3. The TDD is not resolved until both gates pass. Do not claim completion, start an implementation workflow, or skip a failed or pending gate.

## Final Response

Load `references/tdd_final_answer_resolved.md` only after both sign-off gates pass. Treat it as concise wording guidance only. Report the Pi manifest-relative TDD path, local diagram paths when present, and both passed gates. Before completion, report the active decision or gate and do not claim resolution. Do not use legacy paths, remote links, or unavailable commands from the reference.
