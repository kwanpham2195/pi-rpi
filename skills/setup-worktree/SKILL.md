---
name: setup-worktree
description: "Only use when the user explicitly invokes this skill by name."
disable-model-invocation: true
---

# Set Up a Worktree

Create isolated Git worktrees for the active Pi task from the configured workspace files. Do not create a worktree from inside another worktree unless the user explicitly insists.

Task documents are managed under `.pi/artifacts/<task-slug>/`. Select and read them through the existing `rpi_*` artifact tools. Workspace setup shares the authoritative artifact root only through the explicit link in Step 3; never copy, edit, stage, or commit it.

## Workspace configuration

Read `.pi/workspace.json` (shared) and `.pi/workspace.local.json` (local overrides). The effective configuration is `defaults → workspace.json → workspace.local.json`; local scalar values win, matching local repository entries override shared fields, and local entries with new `localPath` values add repositories. In `.pi/workspace.local.json` only, `"$patch": "delete"` removes the matching shared repository entry; do not use `$patch` in `.pi/workspace.json`. `copyGlobs` merge additively with de-duplication rather than replacing inherited values.

A Pi-native single-repository configuration has this shape:

```json
{
  "disabled": false,
  "pathTemplate": "~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "repos": [
    {
      "localPath": ".",
      "description": "Primary repository",
      "primary": true,
      "sourceRef": "origin/main",
      "setupCommand": "",
      "copyGlobs": [
        ".env*",
        ".pi/settings.json",
        ".pi/workspace.local.json"
      ]
    }
  ]
}
```

Only `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` are valid template variables. `branchTemplate` is root-only; repository entries may override `sourceRef`, `setupCommand`, `copyGlobs`, and `primary`.

## Step 0: Decide whether to skip setup

1. Read both workspace configuration files and compute the effective `disabled` value. A local `disabled` value takes precedence.
2. Obtain the active task slug before deriving a branch name. Use the selected task context; if no task is selected, have the user select one with `/rpi-task <slug>` or `rpi_get_task_context`. Do not guess a slug or read artifact files directly.
3. Render and validate the branch name from `branchTemplate` and the task slug with `git check-ref-format --branch <branch>`.

If effective `disabled` is true:

1. Do not create a worktree unless the user explicitly asks to override this disabled setting.
2. Check out the task branch in the current repository with `git checkout -b <branch>`.
3. Stop after a successful checkout. If the branch already exists or checkout fails, report the error and do not claim success.
4. Give this Pi-native completion response:

   ```text
   Workspace setup is disabled by <config path>.

   I checked out branch <branch>. Start Pi in this repository, select the active task if needed, and use the matching implementation skill.

   To re-enable workspace setup, change the value that sets "disabled": true, or add "disabled": false to .pi/workspace.local.json.
   ```

Do not continue unless the user explicitly confirms that a worktree is still wanted.

Next, run `git rev-parse --git-dir`. If the result contains `.git/worktrees/`:

1. Do not create another worktree unless the user explicitly insists.
2. Stop with this Pi-native completion response:

   ```text
   You are already in a worktree at <current directory>.

   Start Pi in this directory, select the active task if needed, and use the matching implementation skill. No additional worktree was created.
   ```

## Step 1: Read the active task

1. Use the selected task context to identify the task slug.
2. Read the `ticket` artifact with `rpi_read_artifact`.
3. Use `rpi_list_artifacts` to discover whether `plan` or `structure-outline` exists, then read the applicable artifact with `rpi_read_artifact`. The task content must inform the branch/worktree summary; do not access `.pi/artifacts/<task-slug>/` directly.

## Step 2: Establish missing configuration

Only when neither workspace configuration file exists:

1. Inspect `scripts/create_worktree.sh` when it exists. Do not execute it merely to discover its preferences.
2. If no legacy script exists, write `.pi/workspace.json` using the single-repository Pi-native default shown above. It branches from `origin/main`, uses `~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}`, and keeps `.pi` local configuration paths.
3. If a legacy script exists, write `.pi/workspace.json` that preserves its useful worktree conventions while retaining Pi paths, the Pi artifact root exclusion, and the current Pi default source ref unless the user asks for a different ref.
4. Ensure `.pi/workspace.local.json` is ignored if a local override will be used. Do not stage either local file or the artifact root.
5. Tell the user that `configure-workspaces` can propose custom paths, commands, copy globs, and multi-repository coordination before any worktree is created.

## Step 3: Create and prepare every configured worktree

1. Parse both configuration files and compute effective settings. Validate that every configured repository exists and is a Git repository, each `sourceRef` resolves to a commit, and a multi-repository configuration has exactly one primary repository.
2. For each repository, resolve `REPOBASENAME` from its repository root, render the path and branch templates, and expand `~` before use.
3. Before creating a worktree, verify that the destination path and branch do not already exist. Do not overwrite, remove, reuse, or guess around either collision; report it and wait for explicit user direction.
4. Resolve the one authoritative artifact root from the checkout containing the selected task. Require its `.pi/artifacts` to exist as a directory, and resolve it to an absolute canonical path. Every repository worktree links to this same root; secondary repositories do not supply independent artifact roots.
5. Create the worktree with:

   ```sh
   git worktree add -b <rendered-branch> <rendered-worktree-path> <source-ref>
   ```

6. In each new worktree, inspect `.pi` without following symlinks. Create it when absent. If it exists as a symlink or is not a directory, stop without changing it. Then inspect `.pi/artifacts` without following symlinks. If any file, directory, symlink, or dangling symlink already occupies that path, stop without changing it. Otherwise create `.pi/artifacts` as a symlink to the authoritative absolute artifact root.
7. Copy existing files matched by the effective `copyGlobs` from the repository root to its worktree, preserving their relative paths. A glob with no match is not an error. Never copy `.pi/artifacts/`, even if a broad or invalid glob would match it; report and refuse that configuration entry instead. The link created in the preceding step is the only workspace-setup exception for the artifact root.
8. When `setupCommand` is non-empty, run it in the new worktree. Report its command, directory, and result. Stop on failure; do not claim the workspace is ready.
9. Continue until every configured worktree has been created, linked, copied, and set up. If any creation, link, copy, or setup step fails, report the exact failing repository, command, and error, then work with the user to resolve it. Do not output the success response below after a failure.

## Successful completion response

Only after every worktree exists and all setup commands have succeeded, report:

- Task slug and rendered branch name for each repository.
- Every worktree path, its primary/non-primary role, authoritative artifact-root link, copied-file result, and setup-command result.
- The shared and local workspace config paths that controlled the result.
- The primary worktree path where implementation should start. Start Pi from that directory, select the task if needed, and use `implement-plan` when a plan exists or `implement-outline` when it does not.
- That `.pi/artifacts/` was linked to the original authoritative root, not copied, staged, or committed. Start a new Pi session in the primary worktree and select the same task with `/rpi-task <task-slug>`.
