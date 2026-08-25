---
name: create-tdd
description: "Runs the technical design interview and writes the TDD artifact with two sign-off gates. Use in a prd-flow task after the PRD, when cross-component and in-code design must be settled before implementation."
---

# Create TDD

Run the technical conversation and write the TDD in two ordered phases: System Design, then Program Design. One question per message; two sign-off gates.

Precedence: TDD > PRD > design discussion (if any) > research > ticket.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`). Task documents are managed under `.pi/artifacts/<task-slug>`; use manifest tools, not direct file mutation.
- Read the approved `prd`, plus `research` and `ticket`, with `rpi_read_artifact`. A TDD in prd flow requires the PRD; use the rpi design workflow when there is no PRD.
- Read the relevant task inputs fully. Exclude research-questions; they are research input, not design context. When product context is thin, do not invent requirements; surface gaps during the interview.

## Process

1. Before creation, load `skills/create-tdd/references/tdd_template.md` for the document shape. Use the registered `artifact-tdd` prompt as the Pi skeleton and use the sibling template to keep its visual and scope requirements. Replace legacy storage and permalink placeholders with the local path returned by Pi.
2. Create the artifact: `rpi_create_artifact` with type `tdd`, description `<feature>`, `dependsOn: ["prd"]`, and content from the `artifact-tdd` prompt. Keep the initial document minimal: title, System Design, Program Design, Patterns to Follow, testing, and the two gates. Open immediately with the first System Design question.
3. Run each decision as an interview loop. Ask exactly one decision per message, ending with one question; options are allowed only when they resolve that same decision. State options, tradeoffs, and a recommendation, then wait. Clarifying discussion and pushback do not resolve a decision.
4. After a decision resolves, rework the relevant section with `rpi_update_artifact`. Keep a cohesive, current design rather than a Q&A transcript or changelog. Rewrite diagrams, prose, and prior sections when needed; cite available research and do not duplicate product requirements.
5. System Design phase: design behavior between services, endpoints, schemas, queues, stores, and external systems. Show today’s state and the intended delta using the smallest useful set of Mermaid control/data-flow diagrams, type signatures, endpoint or message shapes, and data contracts.
6. When a decision depends on existing code, run a foreground `rpi_start_research` fanout with 2-6 `artifact-analyzer` and/or `artifact-pattern-finder` nodes before presenting options, then fold the factual findings into the TDD and relevant research artifact.
7. After System Design resolves, run the system-design gate: ask the user to review that section top to bottom. Incorporate fixes, and do not open Program Design until the user signs off.
8. Program Design phase: design the in-code shape. Nearly every question carries concrete code-shape views: call-stack or component tree, file-tree diff, dependency-injection map, internal signatures, or pseudocode. Render each option in its own code block when alternatives are compared.
9. After Program Design resolves, run the program-design gate before the TDD is resolved. Ask for a top-to-bottom review, incorporate fixes, and record both approved gates in the TDD.
10. When a focused visual is clearer than Mermaid or text, load `skills/create-tdd/references/artifact_template.html` and create a `diagram` artifact with `rpi_create_artifact`, `dependsOn: ["tdd"]`. Keep it focused, use realistic labels, and link to the returned local artifact path from the TDD; use the template’s visual system without requiring a separate HTML file.

## Final response

Only after both sign-offs, load `skills/create-tdd/references/tdd_final_answer_resolved.md`. Follow its next-step format, replacing unavailable remote links with the local TDD path and any local diagram paths. Report the TDD path and confirm both gates passed; before then, report the active gate and do not claim resolution.
