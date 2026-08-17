---
name: create-prd
description: "Runs the product interview and writes the PRD artifact. Use in a prd-flow task after research, when product scope and success must be decided by the user before technical design."
---

# Create PRD

Run the product conversation and write the PRD. One question per message; the user decides; the agent patches.

Precedence: PRD > design discussion (if any) > research > ticket.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read `ticket` and `research` artifacts with `rpi_read_artifact`. Do not read research-questions.

## Process

1. Create the artifact: `rpi_create_artifact` with type `prd`, description `<feature>`, content from the `artifact-prd` template.
2. Establish the foundation first: the Problem to Solve, then the Success lever (a metric/benchmark/error rate, or explicitly "none" for tiny changes).
3. Interview with exactly one question per message. Each question carries options, tradeoffs, and a recommendation. Resolve, then patch the document. Re-paint affected sections; never keep a Q&A log.
4. Where anything visual matters, produce an HTML mockup as a `mockup` artifact (inline or alongside) and get approval before embedding it in the PRD.
5. Keep the conversation product-space. Implementation detail goes to "Deferred to TDD".
6. End with the solution-review gate: the user reads Solution Details top-to-bottom and signs off before the PRD is resolved.

## Final response

Report the PRD path, the success lever, and confirm the solution-review gate passed (or what remains).
