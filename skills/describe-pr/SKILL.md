---
name: describe-pr
description: "Writes a terse PR description for the active task, grounded in the actual diff. Use after implementation when the user asks to describe or open the PR."
---

# Describe PR

Generate the pull request description for the active task's branch, grounded in the artifacts and the actual diff.

## Setup

- Select the task (`rpi_get_task_context` or `/rpi-task`).
- Check the branch and PR state: `git status --short --branch`, `gh pr view --json url,number,title,state,headRefName` if gh is available.

## Process

1. Identify or create the PR:
   - If the current branch has a PR, use it.
   - If the current branch contains the task's work, create it: commit uncommitted task code first (see `ci-commit`), `git push -u origin <branch>`, `gh pr create`.
   - If the branch has unrelated work, list open PRs and ask the user to select one.
2. Gather the diff: `gh pr diff <number>` (or `git diff base...HEAD`), read it fully, and read referenced files for context.
3. Read the task's key artifacts (`ticket`, `research`, `design-discussion`, `prd`, `tdd`, `structure-outline`, `plan`) briefly for context and links.
4. If a `plan` artifact exists, run `rpi_review_implementation` with a `reviewTask` naming the plan artifact and base branch as a quality gate before opening the PR. Report material deviations to the user in chat and fix or flag them; do not paste the four-category review output into the PR body.
5. Write the description: what problem it solves and the user-facing change, in a short paragraph. Then show the shape of the change, not a narrative of how it was built — prefer a `diff` block for changes to an existing shape, a plain code block for a new shape. Include the ticket link from the ticket artifact when present.
6. Save the description as a `pr-description` artifact via `rpi_create_artifact`, then apply it: `gh pr edit <number> --body-file <path>`.

## Rules

- Do not fabricate links or URLs. The manifest holds no permalinks; cite local artifact paths.
- Breaking changes and migration notes must be included in the body; do not add a walkthrough, an exhaustive implementation narrative, a verification checklist, changelog text, or a plan-deviation section.

## Final response

Report the PR number/URL (when available), the description path, and any material deviations found in step 4 (chat only, not in the PR body).
