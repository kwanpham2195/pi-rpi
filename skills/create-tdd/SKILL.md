---
name: create-tdd
description: "Runs a technical design interview and writes a TDD with system and program design sign-off gates."
---

# Create TDD

Run the technical conversation and write the TDD in two ordered phases: System Design, then Program Design. Ask one question per message and preserve both sign-off gates.

## Setup

- **RPI mode:** Only when an active RPI task is already available, read available task artifacts with `rpi_read_artifact` and persist the TDD with RPI artifact tools.
- **Generic mode:** Use user-provided product context, research, and named files. Do not create or select an RPI task and do not call an RPI tool to discover one. Return the document in chat, writing it only to an explicitly user-named path.
- Read relevant inputs fully. If product context is thin, surface gaps during the interview rather than inventing requirements.

## Process

1. Load `references/tdd_template.md` for the canonical document shape. Keep the initial document minimal: title, System Design, Program Design, Patterns to Follow, testing, and the two gates.
2. Draft the initial TDD, then open with the first System Design question. In RPI mode, create `tdd` with `rpi_create_artifact`, description `<feature>`, and `dependsOn: ["prd"]`. In generic mode, deliver the draft in chat or write it to the explicitly named path.
3. Run each decision as a user loop. Ask exactly one decision per message, ending with one question. Give options, tradeoffs, and a recommendation, then wait. Clarification and pushback do not resolve a decision.
4. After a decision resolves, use `rpi_update_artifact` only in RPI mode; otherwise revise the delivered document or explicitly named file. Keep a cohesive current design rather than a Q&A transcript or changelog.
5. System Design covers behavior between services, endpoints, schemas, queues, stores, and external systems. Show today’s state and the intended delta with the smallest useful set of Mermaid control/data-flow diagrams, type signatures, endpoint or message shapes, and data contracts.
6. When a decision needs codebase evidence, run a foreground read-only research pass. In RPI mode, use `rpi_start_research` with 2-6 `artifact-analyzer` and/or `artifact-pattern-finder` nodes, adding `artifact-locator` when paths are unknown and `artifact-web-researcher` only when needed. In generic mode, use available foreground read-only research or analysis tools. Fold findings into the TDD before presenting options.
7. After System Design resolves, ask the user to review it top-to-bottom. Incorporate fixes and do not open Program Design until the user signs off.
8. Program Design covers the in-code shape. Use call-stack or component trees, file-tree diffs, dependency-injection maps, internal signatures, or pseudocode. Render each alternative in its own code block when comparing options.
9. After Program Design resolves, ask for its top-to-bottom review before resolving the TDD. Incorporate fixes and record both approved gates.
10. When a focused visual is clearer than Mermaid or text, load `references/artifact_template.html`. In RPI mode, create a `diagram` artifact with `rpi_create_artifact`, `dependsOn: ["tdd"]`; in generic mode, deliver the visual in chat or write it only to an explicitly named path. Keep it focused, use realistic labels, and link it from the TDD when a path exists.

## Final Response

Load `references/tdd_final_answer_resolved.md` only as concise wording guidance after both sign-offs. In RPI mode, report the artifact path, local diagram paths, and both gates. In generic mode, report the user-named output path when written, otherwise state that the document was delivered in chat; report the active gate or both passed gates without promising a manifest-relative path or an RPI next stage.
