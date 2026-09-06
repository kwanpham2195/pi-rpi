---
name: create-prd
description: "Runs a product interview and writes a PRD when product scope and success must be settled before technical design."
---

# Create PRD

Create a product requirements document that explains what the product should do and why. Keep technical implementation for the TDD. Settle the foundation first, then work through one decision at a time; the PRD is a coherent specification, never a Q&A transcript.

## Setup

- **RPI mode:** Only when an active RPI task is already available, read available task artifacts with `rpi_read_artifact` and persist the PRD with RPI artifact tools.
- **Generic mode:** Use user-provided context, research, and named files. Do not create or select an RPI task and do not call an RPI tool to discover one. Return the document in chat, writing it only to an explicitly user-named path.
- Work from available inputs. Cite findings without duplicating them. If context is thin, surface gaps during the interview rather than inventing requirements.

## Create the Skeleton

1. Load `references/prd_template.md` for the canonical PRD structure and inline visual layout.
2. Draft a minimal PRD with a first-draft Problem to Solve and empty Success, Proposed Solution, and Solution Details sections. Do not add a preamble, setup text, or Q&A log.
3. Open the foundation with exactly one question. Quote the drafted Problem to Solve so the user can react to the actual text.
4. In RPI mode, create `prd` with `rpi_create_artifact`, description `<feature>`, and `dependsOn: ["research"]`. In generic mode, deliver the draft in chat or write it to the explicitly named path.

## Interview Rules

- Ask exactly one independent question in each message. Options may address that decision, but never stack a second decision or vague follow-up.
- Every question gives options, tradeoffs, and a recommendation. Do not edit the PRD until the user clearly resolves the decision.
- After resolution, use `rpi_update_artifact` only in RPI mode; otherwise revise the delivered document or explicitly named file. Rework affected prose, diagrams, mockups, order, and scope so the PRD stays unified.
- Use takeaway headings and short paragraphs. Put visuals beside the prose they explain.
- Stay in product space: user experience, behavior, and outcomes. Put schemas, storage, and architecture under Deferred to TDD.

## Foundation

1. Settle Problem to Solve first, then rewrite it with agreed wording.
2. Settle Success second. Propose a metric, adoption signal, benchmark, error-rate or latency target, qualitative measure, or agreed `none` for a small change without a sensible lever.
3. Do not begin the solution interview until both are resolved and reflected in the PRD.

## Solution Interview and Visuals

1. Walk the solution tree one decision at a time. After each resolution, update Solution Details and affected Proposed Solution, alternatives, out-of-scope content, and visuals.
2. For visual behavior, layout, interaction, or states, create a focused HTML mockup using the documented product design system. In RPI mode, create a `mockup` artifact with `rpi_create_artifact`, `dependsOn: ["prd"]`; in generic mode, deliver it in chat or write it only to an explicitly named path.
3. Keep each mockup focused on its decision and update it as the decision changes. Get user approval before embedding it in the PRD.
4. Use diagrams or mockups whenever they explain a decision better than prose.

## Solution-Review Gate

When the solution is complete, ask the user to review Solution Details top-to-bottom. Incorporate corrections through the active mode. The PRD is not resolved until the user explicitly approves this gate.

## Final Response

Load `references/prd_final_answer_resolved.md` only as concise wording guidance after the gate passes. In RPI mode, report the artifact path, success lever, and gate status. In generic mode, report the user-named output path when written, otherwise state that the document was delivered in chat; report the success lever and active decision or gate without promising a manifest-relative path or an RPI next stage.
