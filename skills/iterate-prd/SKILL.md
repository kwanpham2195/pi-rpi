---
name: iterate-prd
description: "Updates the PRD artifact in place as product decisions evolve. Use when the user gives feedback, wants more grilling, or surfaces questions on the PRD."
---

# Iterate PRD

Update the existing PRD artifact in place. Guide the product conversation; do not execute independent product decisions without the user.

Precedence: PRD > design discussion > research > ticket.

## Setup

- Select the task with `rpi_get_task_context` or `/rpi-task`, then use `rpi_list_artifacts` to identify the PRD and supporting artifacts.
- Read the current `prd`, `design-discussion` when present, `research`, and `ticket` artifacts with `rpi_read_artifact`. Never read `research-questions`.

## Initial Choice and Interview Loop

1. If no feedback is given, ask the user to choose one path: provide specific feedback, continue grilling the solution one decision at a time, or surface additional product questions. Then wait.
2. Ask exactly one independent question in each message. Options, tradeoffs, and a recommendation may address that question; do not stack a second decision or ask vague feedback.
3. Treat clarification and pushback as discussion, not a resolution. Update the PRD only after the user clearly resolves the decision.
4. Verify corrections against named sources. When a product decision needs current-state evidence, use `rpi_start_research` with 2-6 matching installed nodes: `artifact-locator`, `artifact-analyzer`, or `artifact-pattern-finder`; use `artifact-web-researcher` only for needed external documentation. Fold the facts into the relevant task artifact before presenting options.
5. After resolution, update the PRD with `rpi_update_artifact`. Rework the affected Problem to Solve, Success, Proposed Solution, Solution Details, alternatives, out-of-scope content, and visuals so the document remains coherent, current, and free of a Q&A log.
6. After each update, stop and ask what to work on next. If decisions remain, offer only the next decision that unblocks them.

## Product and Visual Rules

- Stay in product space: user experience, behavior, and outcomes. Put schemas, storage, and implementation architecture under Deferred to TDD.
- Keep short prose and takeaway headings that state the result, not only the topic. Put each visual beside the prose it explains.
- For visual behavior, layout, interaction, or states, update the relevant mockup artifact with `rpi_update_artifact`. If feedback introduces a new UI concept, create a focused `mockup` artifact with `rpi_create_artifact`, `dependsOn: ["prd"]`, realistic labels, and the documented product design system. Research the design system first when it is unknown.
- Re-embed the approved local mockup artifact path in the PRD after it matches the resolved decision.
- Treat Success as a useful lever: record an agreed metric, adoption signal, benchmark, error-rate or latency target, qualitative measure, or an agreed `none` for a small change with no sensible measure.

## Solution-Review Gate and Final Response

- When the solution is fully fleshed out, stop the interview and ask the user to review Solution Details from top to bottom. Incorporate corrections with `rpi_update_artifact`.
- The PRD is not resolved until the user explicitly approves this Solution Details review gate.
- Load `references/prd_final_answer_resolved.md` only after that gate passes. Use it only as concise wording guidance; report the Pi manifest-relative PRD path, success lever, and completed gate. Before approval, report the PRD path and one active decision or review gate. Do not use legacy paths, remote links, or unavailable commands from the reference.
