---
name: create-design-discussion
description: "Turns research and the ticket into an explicit user-decided design document. Use after research when the task flow is rpi and design decisions must be resolved by the user."
---

# Create Design Discussion

Use only when the user explicitly invokes this skill. Turn research and the ticket into explicit design decisions. The user resolves every decision; the agent never resolves one on its own.

Precedence: design discussion > research > ticket.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`.
- Read the `ticket` and `research` artifacts fully with `rpi_read_artifact`. Read other relevant task artifacts only when needed for the requested decision; never read `research-questions`.
- Read relevant source files fully when they are named by the research or required to give exact pattern evidence. Do this in the main context before starting any research fanout.

## Process

1. Build the document from the ticket and research. Do not duplicate upstream findings; use them to ground the current state, constraints, and existing patterns.
2. If a decision depends on facts not covered by the research, use `rpi_start_research` with 2-6 matching registered nodes: `artifact-locator`, `artifact-analyzer`, and/or `artifact-pattern-finder`. Use `artifact-web-researcher` only for necessary external documentation. Incorporate the factual findings before presenting options.
3. Load the registered `artifact-design-discussion` prompt before creating content. Load `references/design_discussion_template.md` only when its expanded document sections, diagrams, or pattern-example layout are needed. It is a formatting aid, not an artifact path or tool contract.
4. Create the artifact with `rpi_create_artifact`: type `design-discussion`, description `<topic>`, `dependsOn: ["research"]`, and content based on `artifact-design-discussion`.
5. Write a cohesive document that includes:
   - Current State, from research, and Desired End State, from the request.
   - Explicit out-of-scope behavior.
   - A Proposed End State Architecture with before/after diagrams, concise prose, or pseudocode when useful.
   - Existing patterns to follow, with source locations and concise multiline examples when research supports them.
   - A testing approach when research identifies relevant test patterns.
6. Put every initial decision under open Design Decisions. For each decision, give the decision, options, tradeoffs, and a recommendation. Do not put an initial decision in Resolved and do not imply that a recommendation is a decision.
7. Run each decision as a user loop. Ask for the user’s decision, keep the decision open through clarification or pushback, and update the design artifact with `rpi_update_artifact` only after the user clearly resolves it.
8. On resolution, move the decision to Resolved with the selected option, rationale, and rejected options. Rework all affected sections, diagrams, pseudocode, pattern guidance, and testing guidance so the document remains a cohesive current design, not a decision log.

## Quality Bar

- The document describes the requested product behavior and architecture without inventing codebase facts.
- All initial decisions remain open, even when an option appears obvious.
- Only explicit user feedback resolves a decision.
- When documents conflict, this design discussion supersedes research and the ticket.

## Final Response

- When one or more design decisions remain open, load `references/design_discussion_final_answer.md` for the concise review-and-decision response shape.
- Only after the user has resolved every decision, load `references/design_discussion_final_answer_resolved.md` for the completion response shape.
- Treat both local references as wording guides only. Report the Pi manifest-relative path returned by `rpi_create_artifact`; do not use unavailable commands, external links, or non-Pi artifact paths from the references.

Report the artifact path and the decisions still awaiting the user. When all decisions are resolved, state that they are resolved and that the document is ready for the next registered RPI workflow stage. Do not add a separate summary.
