---
name: ci-commit
description: "Only use when the user explicitly invokes this skill by name."
---

# Commit Changes

Create Git commits for the implementation changes made in this session. Never commit the Pi artifact root.

## Rules

- Use the full session context to identify the work that belongs in these commits.
- Stage literal, explicit paths only. Never use `git add -A`, `git add .`, `git add -f`, globs, or other broad staging forms.
- Never stage or commit `.pi/artifacts/` or any path below it. The `/rpi-init` ignore entry is a safeguard, not proof; inspect the index before every commit.
- Never stage generated, dummy, test-only, or unrelated files, including files created by another task or agent.
- Group related changes into focused, atomic commits. Follow the repository's message convention; otherwise use a conventional, imperative message that states why the change is needed.
- Run the repository's required relevant checks before committing, or report an already-completed equivalent gate. Never bypass hooks or checks with `--no-verify`.
- The explicit skill invocation is the user's confirmation to commit. Do not stop to ask for more feedback once this skill is in use.

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
