---
name: create-research-questions
description: "Creates neutral research questions from available context. Use at the start of research to define current-state questions before investigation."
---

# Create Research Questions

Create a query plan that helps later research describe the current codebase, dependencies, and relevant external behavior. Do not propose a solution.

## Setup

- **RPI mode:** Only when an active RPI task is already available, read its ticket and collateral with `rpi_read_artifact` and persist the result with `rpi_create_artifact`.
- **Generic mode:** Use user-provided context and named files. Do not create or select an RPI task and do not call an RPI tool to discover one. Return the document in chat, writing it only to an explicitly user-named path.
- Preserve verbatim Key Context Pointers from the available inputs: URLs, documents, repositories, packages, dependencies, file paths, and directories.

## Process

1. Read the available context, named collateral, and context pointers before starting research.
2. If the context is not enough to write grounded questions, run a foreground read-only research pass. In RPI mode, use `rpi_start_research` with 2-6 matching package nodes: `artifact-locator`, `artifact-analyzer`, `artifact-pattern-finder`, and `artifact-web-researcher` only when external documentation is needed. In generic mode, use available foreground read-only research or analysis tools. Synthesize findings; do not treat them as implementation recommendations.
3. Load `references/research_questions_template.md` for the canonical document shape when needed.
4. Write 2-8 questions, scaled to the task. Each question must ask what exists, where it lives, how it works, how modules interact, relevant constraints or edge cases, and how it is tested. Include concrete pointers where they make research faster.
5. Keep questions neutral and descriptive:
   - Never leak task intent or prescribe a change. Write “How does X work today?” rather than “How should we build X?”
   - Do not ask what the codebase needs, or suggest improvements, unless the user explicitly requests that scope.
   - Include libraries and dependencies when their capabilities or behavior must be understood.
   - If frontend or visual work may be involved, include questions about the product design system, component library, colors, typography, spacing, borders, shadows, and theming.
6. In RPI mode, create `research-questions` with `rpi_create_artifact`, description `<topic>`, and `dependsOn: []`. In generic mode, deliver the completed document in chat or write it to the explicitly named path.

## Quality Bar

- The question set documents only the current state and points the research phase to high-signal evidence.
- Key Context Pointers preserve supplied values verbatim and are omitted only when none exist.
- Questions are specific enough to direct research but contain no proposed architecture or implementation direction.

## Final Response

Load `references/research_questions_final_answer.md` only as concise wording guidance. In RPI mode, report the artifact path and invite review before research. In generic mode, report the user-named output path when written, otherwise state that the document was delivered in chat; do not promise a manifest-relative path or an RPI next stage.
