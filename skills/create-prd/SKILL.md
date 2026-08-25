---
name: create-prd
description: "Runs the product interview and writes the PRD artifact. Use in a prd-flow task after research, when product scope and success must be decided by the user before technical design."
---

# Create PRD

Use only when the user explicitly invokes this skill. Create a product requirements document that explains what the product should do and why. Keep technical implementation for the TDD.

Run a guided product conversation. Settle the foundation first, then work through the solution one decision at a time. The PRD is always a coherent specification, never a Q&A transcript.

Precedence: PRD > design discussion (if any) > research > ticket.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`.
- Read `ticket` and `research` fully with `rpi_read_artifact`. Read a design discussion only when it exists and is relevant. Never read `research-questions`.
- Work from the available inputs. Cite their findings in the PRD without duplicating them. If context is thin, do not invent requirements; surface gaps during the interview.
- When a decision needs more present-state evidence, use `rpi_start_research` with 2-6 matching registered nodes: `artifact-locator`, `artifact-analyzer`, `artifact-pattern-finder`, and, only when necessary, `artifact-web-researcher`. Fold factual findings into the relevant task artifact before using them.

## Create the Skeleton

1. Load the registered `artifact-prd` prompt before creating content. Load `references/prd_template.md` only when its expanded PRD structure or inline visual layout is needed. It is a formatting aid, not an artifact path or tool contract.
2. Create the PRD with `rpi_create_artifact`: type `prd`, description `<feature>`, `dependsOn: ["research"]`, and content based on `artifact-prd`.
3. Keep the initial artifact minimal: a first-draft Problem to Solve and empty Success, Proposed Solution, and Solution Details sections. Do not add a preamble, setup text, or Q&A log.
4. Open the foundation immediately with exactly one question. Quote the drafted Problem to Solve so the user can react to the actual text.

## Interview Rules

- Ask exactly one independent question in each message. Options are allowed when they address that one decision, but never stack a second decision or a vague follow-up.
- Every question gives options, tradeoffs, and a recommendation. Work through clarification and pushback without editing the PRD until the user clearly resolves the decision.
- After resolution, use `rpi_update_artifact` to rework all affected prose, diagrams, mockups, order, and scope. The PRD must read as a unified description of what is known now, not a decision record.
- Use takeaway headings that tell the reader the point of each section. Keep paragraphs short and place visuals beside the prose they explain.
- Stay in product space: user experience, behavior, and outcomes. Put schemas, storage, and architecture questions in Deferred to TDD rather than interviewing on them here.

## Foundation

1. Settle Problem to Solve first. Iterate until the user agrees, then rewrite that section with the agreed wording.
2. Settle Success second. Propose a suitable success lever: a product metric, adoption signal, benchmark, error-rate or latency target, or qualitative measure. For a tiny change with no sensible lever, get the user’s agreement to record `none` instead of inventing a metric.
3. Do not begin the solution interview until both Problem to Solve and Success are resolved and reflected in the PRD.

## Solution Interview and Visuals

1. Walk the solution tree one decision at a time. After each resolved decision, update Solution Details and any affected Proposed Solution, alternatives, out-of-scope content, and visuals.
2. When visual behavior, layout, interaction, or states matter, create an HTML mockup as a `mockup` artifact with `rpi_create_artifact`, `dependsOn: ["prd"]`, and an appropriate description. Use the product’s documented design system; if it is unknown, research it before making the mockup.
3. Keep each mockup focused on its decision and update it as the decision changes. Get user approval before embedding the approved mockup in the PRD.
4. Use diagrams or mockups whenever they explain a decision better than prose.

## Solution-Review Gate

When the solution is complete, stop the interview and ask the user to read Solution Details top-to-bottom. Incorporate any corrections with `rpi_update_artifact`. The PRD is not resolved until the user explicitly approves this review gate.

## Final Response

Load `references/prd_final_answer_resolved.md` only after the user approves the Solution Details review gate. Use it only for concise completion wording; report the Pi manifest-relative artifact path returned by `rpi_create_artifact` and do not use unavailable commands, external links, or non-Pi artifact paths from the reference.

Before the gate passes, report the PRD path, current success lever, and the one remaining review or interview decision. After it passes, report the PRD path, success lever, and that the Solution Details review gate passed. Do not add a separate summary.
