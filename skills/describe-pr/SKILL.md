---
name: describe-pr
description: "Writes a terse PR description for the active task, grounded in the actual diff. Use after implementation when the user asks to describe or open the PR."
---

# Describe PR

Generate the pull request description for the active task's branch, grounded in the artifacts and the actual diff.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`). Task documents are managed under `.pi/artifacts/<task-slug>`; use manifest tools, not direct file mutation.
- Check the branch and PR state: `git status --short --branch`, then `gh pr view --json url,number,title,state,baseRefName,headRefName 2>/dev/null` when `gh` is available.

## Process

1. Use `rpi_list_artifacts`, then read the task's relevant artifacts (`ticket`, `research`, `design-discussion`, `prd`, `tdd`, `structure-outline`, `plan`) with `rpi_read_artifact`. Read the complete implementation diff and enough surrounding source to explain behavior and ownership. Use `rpi_git_diff` with the task base ref before any PR-open command; when a branch PR already exists, also use its changed-file metadata and full diff when available.
2. If a `plan` artifact exists, run `rpi_review_implementation` with a review task naming the plan and base ref. Report material deviations in chat and fix or flag them before opening or editing a PR. Do not paste the reviewer’s report or a plan-deviation section into the PR body.
3. Identify the PR only after that gate. Use the branch PR when it exists. Otherwise inspect the branch work, then obtain explicit user authorization for commit, push, or PR creation before each corresponding publishing action: commit task code with `ci-commit`, push with an upstream, or create a PR with `gh pr create`. A request to describe a PR alone grants none of those permissions. Ask the user to select a PR only when the branch has no relevant work and no safe current-branch PR can be created.
4. Before drafting, load `references/pr_description_template.md` and `references/show-me.md`, resolved relative to this skill directory. Use the template’s headings and the visual conventions, but omit its unavailable task or walkthrough URL placeholders; include a ticket link only when a real ticket URL exists.
5. Write the PR body in simple, concise language:
   - Keep **Why the change** to exactly one sentence.
   - Keep **Special things to note** to 1-3 reviewer-relevant bullets, using `- None.` when no note applies.
   - Make **Change outline** a compact structural view, not a file-by-file narrative. Include only useful schema/endpoint contracts, pseudocode, shallow file trees, component trees, and call/control/data-flow views. Prefer focused `diff` blocks for existing shapes and complete code blocks for mostly new shapes.
6. When a separate walkthrough materially helps reviewers, load `references/pr_walkthrough_example.html`, resolved relative to this skill directory, and replace all placeholders with actual diff facts. Update an existing active `pr-walkthrough` with `rpi_update_artifact`, or create one through `rpi_create_artifact` when none exists. Use `dependsOn: ["implementation"]`; keep the walkthrough separate from the PR body and record its returned local path for the final response.
   - To inject diffs, materialize the managed content returned by `rpi_read_artifact` in a disposable temporary copy. Resolve `scripts/inject-walkthrough-diffs.sh` to an absolute script path from this skill directory, then run `bash <absolute-script-path> <temporary-copy-path> --range <base-ref>...HEAD` with the implementation repository as the current working directory. Do this only after the walkthrough contains the example’s empty diff stash and selected `diffFile` entries, Bash and Git are available, and `<base-ref>` resolves locally. Persist the resulting content through `rpi_update_artifact`; never run the script against the managed artifact path.
   - If any prerequisite is absent or the script fails, use `rpi_git_diff` with the same base ref, insert only the selected bounded hunks through `rpi_update_artifact`, and state that the walkthrough diff source was bounded. Do not invoke the script otherwise.
7. Save the description as `pr-description`, with `dependsOn: ["implementation"]`: update an existing `pr-description` with `rpi_update_artifact`, or create it with `rpi_create_artifact` when none exists. Apply the returned local artifact path with `gh pr edit <number> --body-file <path>` and confirm the update succeeded.

## Rules

- Do not fabricate links or URLs. The manifest holds no permalinks; cite local artifact paths only in chat, not as public PR links.
- Breaking changes and migration notes must be included in the body. Do not add a walkthrough to the PR body, an exhaustive implementation narrative, a verification checklist, changelog text, or a plan-deviation section.

## Final response

Load `references/describe_pr_final_answer.md`, resolved relative to this skill directory, after the PR update. Follow its status, summary, changed-files, deviations, and next-step format; replace unavailable remote artifact links with the local paths returned by Pi and omit the task URL field. Report the PR number/URL when available, the description path, any walkthrough path, and material deviations in chat only.
