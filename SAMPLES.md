# Sample task walkthrough

Run this in an empty Git repository after a local install:

```bash
pi install -l /path/to/pi-rpi
```

## Create and select a task

```text
/rpi-init
/rpi-new
/rpi-task eng-1478-parent-child
```

The selected task is available to commands and tools in this extension session. `rpi_get_task_context` restores a selection from a previous tool result.

## Create the document chain

1. Run `create-research-questions`; it creates `research-questions` with `dependsOn: []`.
2. Run `create-research`; it creates `research` with `dependsOn: ["research-questions"]`.
3. Continue with the flow. In rpi, design depends on research and outline depends on design. In prd, PRD depends on research, TDD depends on PRD, and outline depends on TDD. A plan is optional and depends on the outline.

Each artifact appears under `.pi/artifacts/<slug>/` with a chronological filename and a manifest entry.

## Implement a phase

Use `implement-outline` or `implement-plan` one phase at a time. After automated checks and human manual verification:

1. Commit explicit source paths with `ci-commit`.
2. Create or update the implementation artifact through `rpi_create_artifact` or `rpi_update_artifact`.
3. Call `rpi_record_phase_commit` with the phase ID, agent run ID, and verified commit SHA.

An agent-run receipt alone does not mark a phase committed or human-approved.

## Resume

Use `/rpi-task eng-1478-parent-child` to select the task again. The manifest retains artifact state and receipts. Check plan or outline progress and verify the associated commit receipt before treating a phase as complete.

## Troubleshooting

- Agent tools require `pi install` or `pi install -l`; `pi -e` loads only the extension surface.
- Artifact reads and `rpi_git_diff` return bounded output with a truncation marker.
- The stage guard rejects broad or ambiguous `git add` commands. Stage explicit source files instead.
- `draft → approved` is invalid; set the artifact to `in-review` first.
