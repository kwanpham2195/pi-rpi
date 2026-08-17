---
name: setup-worktree
description: Creates a git worktree for the active task from the workspace config, copying local files and running the setup command. Use before implementation when the project uses task worktrees; skips cleanly when disabled or already inside a worktree.
---

# Setup Worktree

Create a git worktree for the active task so implementation runs on an isolated branch.

## Config

Read `.pi/workspace.json` (shared, committed) and `.pi/workspace.local.json` (local overrides, gitignored). Local wins. If neither exists, see `configure-workspaces`.

Config shape:

```json
{
  "disabled": false,
  "pathTemplate": "~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "repos": [
    {
      "localPath": ".",
      "description": "Primary repository",
      "sourceRef": "HEAD",
      "setupCommand": "",
      "copyGlobs": [".env*", ".pi/settings.json"]
    }
  ]
}
```

## Skip branches

- If `disabled` is true (local overrides shared): check out the task branch in place with `git checkout -b <branch>` and stop. Re-enable by setting `disabled: false` in the local file.
- If already inside a worktree (`git rev-parse --git-dir` contains `.git/worktrees/`): stop and tell the user they are already in a worktree. Never create a worktree from inside one unless the user explicitly insists.

## Process

1. Read the ticket and outline/plan artifacts (`rpi_read_artifact`) so the branch name reflects the task.
2. For each repo in `repos`:
   - Create the worktree: `git worktree add -b <branchTemplate(TASKSLUG)> <pathTemplate(TASKSLUG, REPOBASENAME)> <sourceRef>`.
   - Copy files matching `copyGlobs` from the repo root into the new worktree, preserving relative structure.
   - Run `setupCommand` inside the new worktree.
3. Report failures and work with the user to complete setup. Only report success when every worktree exists and setup is done.

## Final response

Report the worktree path(s) and branch name, and the command to start implementation there (e.g. `pi -e <pkg>` in that directory). Never commit the artifact root.
