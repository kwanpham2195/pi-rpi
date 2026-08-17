---
name: describe-pr
description: Writes the PR description for the active task, with plan-vs-implementation deviation review and an optional walkthrough. Use after implementation when the user asks to describe or open the PR.
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
4. Deviation analysis: if a `plan` artifact exists, run `rpi_review_implementation` with a `reviewTask` naming the plan artifact and base branch. Include the four-category output in the "Deviations from the plan" section.
5. Walkthrough: for large diffs (roughly 300+ changed lines and 5+ files), create a `pr-walkthrough` artifact narrating the change; skip it for small diffs.
6. Write the description: what problem, user-facing changes, how it was implemented, deviations, how to verify (worktree commands), changelog entry. Include the ticket link from the ticket artifact when present.
7. Save the description as a `pr-description` artifact via `rpi_create_artifact`, then apply it: `gh pr edit <number> --body-file <path>`.

## Rules

- Do not fabricate links or URLs. The manifest holds no permalinks; cite local artifact paths.
- Prominent deviations, breaking changes, and migration notes must be included.

## Final response

Report the PR number/URL (when available), the description path, and the deviation summary.
