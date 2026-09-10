---
name: ci-commit
description: "Commits the current task's verified implementation after explicit commit authorization from the user or a calling implementation skill's human gate."
---

# Commit Changes

Create Git commits for the implementation changes made in this session. Never commit the Pi artifact root.

## Rules

- Use the full session context to identify the work that belongs in these commits.
- Stage literal, explicit paths only. Never use `git add -A`, `git add .`, `git add -f`, globs, or other broad staging forms.
- Never stage or commit `.pi/artifacts/` or any path below it. The `/rpi-init` ignore entry is a safeguard, not proof; inspect the index before every commit.
- Stage the implementation's real source and regression tests, including authorized implementation-child work for this task. Exclude temporary probes, generated scratch files, and unrelated work from other tasks or agents.
- Group related changes into focused, atomic commits. Follow the repository's message convention; otherwise use a conventional, imperative message that states why the change is needed.
- Run the repository's required relevant checks before committing, or report an already-completed equivalent gate. Never bypass hooks or checks with `--no-verify`.
- Loading this skill does not authorize a commit. Commit only after explicit user authorization, including explicit confirmation at a calling implementation skill's human gate. Once authorized, do not ask for redundant confirmation.

## Process

1. Review the session work, then inspect both unstaged and staged state with `git status --short`, `git diff`, and `git diff --cached`.
2. Plan one or more commits. Name the exact paths for each group; exclude unrelated changes.
3. Stage each approved group with explicit literal paths only.
4. Before each commit, inspect `git diff --cached --name-only`. It must not contain a path under `.pi/artifacts/`. For example:

   ```sh
   if git diff --cached --name-only | grep -q '^\.pi/artifacts/'; then
     echo 'Refusing to commit Pi artifacts.' >&2
     exit 1
   fi
   ```

5. Run the required relevant validation for the staged change, then create the planned commit with `git commit -m`.
6. Repeat for the remaining planned groups. Finish by inspecting `git status --short`.

## Final response

Report each commit SHA and message, the validation run, any intentionally uncommitted files, and the final working-tree state. State explicitly that no `.pi/artifacts/` paths were staged or committed.
