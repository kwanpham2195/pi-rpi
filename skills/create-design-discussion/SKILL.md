---
name: create-design-discussion
description: "Runs a decision-focused design discussion and writes a cohesive design document grounded in available research."
---

# Create Design Discussion

Build a cohesive design document from available inputs. The user resolves decisions; recommendations do not resolve them.

## Setup

- **RPI mode:** Only when an active RPI task is already available, read task artifacts with `rpi_read_artifact` and persist the design document with RPI artifact tools.
- **Generic mode:** Use user-provided context, research, and named files. Do not create or select an RPI task and do not call an RPI tool to discover one. Return the document in chat, writing it only to an explicitly user-named path.
- Read relevant source files fully when research or the user names them.

## Process

1. Build the document from the available context and research. Do not duplicate upstream findings; use them to ground the current state, constraints, and existing patterns.
2. When a decision needs facts not covered by the available research, run a foreground read-only research pass. In RPI mode, use `rpi_start_research` with 2-6 matching `artifact-locator`, `artifact-analyzer`, `artifact-pattern-finder`, and only-needed `artifact-web-researcher` nodes. In generic mode, use available foreground read-only research or analysis tools. Incorporate findings before presenting options.
3. Load `references/design_discussion_template.md` for the canonical document shape.
4. Write a cohesive document with:
   - Current State from research and Desired End State from the request.
   - Explicit out-of-scope behavior.
   - A Proposed End State Architecture with before/after diagrams, concise prose, or pseudocode when useful.
   - Existing patterns to follow, with source locations and concise multiline examples when research supports them.
   - A testing approach when research identifies relevant test patterns.
5. Put every initial decision under open Design Decisions. For each decision, give the decision, options, tradeoffs, and a recommendation. Do not put an initial decision in Resolved or imply that a recommendation is a decision.
6. Run each decision as a user loop. Keep a decision open through clarification or pushback. In RPI mode, update the artifact with `rpi_update_artifact` only after clear user resolution; in generic mode, revise the delivered document or explicitly named file only after resolution.
7. On resolution, move the decision to Resolved with the selected option, rationale, and rejected options. Rework affected sections, diagrams, pseudocode, pattern guidance, and testing guidance so the document remains cohesive rather than becoming a decision log.
8. In RPI mode, create `design-discussion` with `rpi_create_artifact`, description `<topic>`, and `dependsOn: ["research"]`. In generic mode, deliver the completed document in chat or write it to the explicitly named path.

## Quality Bar

- The document describes requested product behavior and architecture without inventing codebase facts.
- All initial decisions remain open until explicit user feedback resolves them.
- When documents conflict, this design discussion supersedes its inputs.

## Final Response

Use `references/design_discussion_final_answer.md` while decisions remain, or `references/design_discussion_final_answer_resolved.md` after all resolve, only as concise wording guidance. In RPI mode, report the artifact path and remaining decisions. In generic mode, report the user-named output path when written, otherwise state that the document was delivered in chat; report remaining decisions without promising a manifest-relative path or an RPI next stage.
