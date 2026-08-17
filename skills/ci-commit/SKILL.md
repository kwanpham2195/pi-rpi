---
name: ci-commit
description: "Commits implementation changes for the active task with grouped, conventional messages, never staging the artifact root. Use when the user asks to commit work or after an implementation phase passes its gate."
---

# Commit

Create clean commits for the task's implementation work. The artifact root is never committed.

## Rules

- Stage explicit paths only. Never use `git add -A`, `git add .`, or `git add -f`.
- Never stage anything under the artifact root (default `.pi/artifacts/`); the `/rpi-init` gitignore entry normally covers it, but verify before committing.
- Never commit generated, dummy, or test-only files.
- Group related files into focused commits; message in imperative mood focused on why, per the repo's convention (conventional commits unless the repo's history differs).
- Once committing, do not stop to ask for feedback.

## Process

1. Review `git status` and `git diff` (unstaged + staged).
2. Verify no artifact-root paths are staged: `git diff --cached --name-only | grep -c '^\.pi/artifacts'` must print 0 (grep exits 1 on no match — treat that as pass).
3. Plan the commit(s): group related changes.
4. Stage explicit paths and commit.

## Final response

Report the commit(s) and the state of the working tree.
