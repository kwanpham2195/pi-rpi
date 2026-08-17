---
name: create-tdd
description: Runs the technical design interview and writes the TDD artifact with two sign-off gates. Use in a prd-flow task after the PRD, when cross-component and in-code design must be settled before implementation.
---

# Create TDD

Run the technical conversation and write the TDD in two ordered phases: System Design, then Program Design. One question per message; two sign-off gates.

Precedence: TDD > PRD > design discussion (if any) > research > ticket.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Read `prd`, `design-discussion`, `research`, and `ticket` artifacts with `rpi_read_artifact`. Without a PRD, the ticket/research alone are sufficient.

## Process

1. Create the artifact: `rpi_create_artifact` with type `tdd`, description `<feature>`, content from the `artifact-tdd` template.
2. System Design phase: one question per message, options presented as diagrams, type signatures, endpoint shapes, and data contracts. Use mermaid for control/data flow.
3. When a system design choice depends on existing code, run `artifact-analyzer` / `artifact-pattern-finder` research first.
4. After System Design resolves, run the system-design gate: the user signs off before Program Design opens.
5. Program Design phase: nearly every message carries a code shape — call-stack tree, component tree, file-tree diff, dependency-injection map, signatures, or pseudocode.
6. After Program Design resolves, run the program-design gate before the TDD is resolved.
7. Where a concept is clearer as a visual artifact than text, produce a `diagram` artifact.

## Final response

Report the TDD path and confirm both gates passed (or what remains).
