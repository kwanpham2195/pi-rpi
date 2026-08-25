---
name: configure-workspaces
description: "Propose and generate Pi workspace configuration files for a repository."
---

# Configure Workspaces

Read the project, propose a concise Pi worktree configuration, write it only after approval, and validate it. These files control the worktrees created by `setup-worktree`:

- `.pi/workspace.json` is shared team configuration and can be committed.
- `.pi/workspace.local.json` contains machine-specific overrides and must be gitignored.
- Task documents remain under `.pi/artifacts/<task-slug>/`; use the `rpi_*` artifact tools for them and never treat them as workspace configuration.

Use plain, brief language.

## Step 0: Select the repository

1. Run `pwd` and `git rev-parse --show-toplevel`.
2. When Git succeeds, use the returned repository root for all remaining reads and commands, and state that path.
3. When the current directory is not in a Git repository, ask: `Which repository should I configure? Send its path.` Confirm the supplied path with `git -C <path> rev-parse --show-toplevel` before continuing.

## Step 1: Read the project

From the selected repository root:

1. Read existing `.pi/workspace.json` and `.pi/workspace.local.json` when present. Start from existing configuration instead of replacing it.
2. Inspect workspace signals: `.pi/settings.json`, `AGENTS.md`, the sibling directory layout, `package.json`, package-manager files, `Makefile`, `README.md`, and `git remote -v`.
3. Infer whether this is a single repository or a coordination repository with related sibling repositories. Do not add unrelated repositories merely because they are adjacent.

## Step 2: Build and present the proposal

Infer a complete proposal from the project and the user's request.

- Use a single-repository configuration unless the project clearly coordinates related repositories.
- For one repository, use `{"localPath": ".", "primary": true}`.
- For multiple repositories, include only related paths and mark exactly one repository as `"primary": true`. Prefer the repository that owns the shared Pi settings, agent policy, or task coordination.
- Use `~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}` as the default `pathTemplate` and `{{ TASKSLUG }}` as the root-level `branchTemplate`.
- Default each repository's `sourceRef` to `origin/main`. If more than one remote could supply the branch-off ref, ask the user which remote/ref to use before proposing it.
- Infer a non-empty `setupCommand` only from the project's documented setup command, scripts, package manager, or Makefile. State what that command will do because it runs after worktree creation.
- Include only useful existing local files in `copyGlobs`, such as `.env*`, `.pi/settings.json`, and `.pi/workspace.local.json`. Put machine-only values in the local file.

For a new single-repository configuration, use this Pi-native shape:

```json
{
  "disabled": false,
  "pathTemplate": "~/.pi/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}",
  "branchTemplate": "{{ TASKSLUG }}",
  "repos": [
    {
      "localPath": ".",
      "description": "Selected repository",
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

For a multi-repository workspace, retain the root fields and add related repositories with paths relative to the selected repository, for example `../api` and `../web`. Sessions start in the primary repository worktree by default; select the repository that should supply the normal Pi settings and task workflow as primary.

The first response after inspection must show the complete proposed `.pi/workspace.json` in a fenced `json` block. If local overrides are useful, show the complete proposed `.pi/workspace.local.json` in a second fenced `json` block. End with:

```text
Tell me what to change, or approve this config.
```

After user feedback, update and print the complete proposal again. Do not write either file until the user approves it.

## Step 3: Validate the proposal

Before asking for approval, verify:

- `{{ TASKSLUG }}` and `{{ REPOBASENAME }}` are the only template variables.
- `localPath: "."` is the selected repository; other paths are relative to it.
- Multi-repository configurations have exactly one `primary` repository. A single-repository configuration is primary.
- `disabled: true` at the root disables worktree creation. A local `disabled` value overrides the shared value.
- Scalar values follow `defaults → workspace.json → workspace.local.json`; matching local repository entries override their shared repository fields, while new local repository entries add repositories. In `.pi/workspace.local.json` only, a repository entry with `"$patch": "delete"` removes the matching shared repository entry; do not use `$patch` in `.pi/workspace.json`.
- Root and repository `copyGlobs` merge additively with de-duplication. They do not replace inherited entries. Repository entries can override `sourceRef`, `setupCommand`, `copyGlobs`, and `primary`; `branchTemplate` remains root-only.

Validate the proposal as data and against the repository:

1. Parse the proposed JSON.
2. Run `git remote -v`.
3. For every configured `localPath`, verify that the directory exists and `git -C <localPath> rev-parse --git-dir` succeeds.
4. For every remote-qualified `sourceRef`, verify that the named remote exists in that repository. Verify that the ref resolves before worktree creation.
5. State the rendered paths, branch template, setup command, and effective copy globs. Do not run the setup command during configuration.

## Step 4: Write the approved configuration

After approval:

1. Write the approved shared file to `.pi/workspace.json`.
2. Write `.pi/workspace.local.json` only when local overrides are part of the approved proposal.
3. Read `.gitignore`; if needed, add the exact line `.pi/workspace.local.json`. Do not remove or rewrite existing ignore rules.
4. Parse the written JSON and re-check every configured repository and source ref.

Do not stage files automatically. When the team is ready to commit the shared configuration, use `ci-commit` or stage only `.pi/workspace.json` after checking the index. Never stage `.pi/workspace.local.json` or anything under `.pi/artifacts/`.

## Step 5: Confirm and summarize

Report:

- The config paths written and whether each is shared or local.
- The number of configured repositories and the primary repository.
- The path and branch templates, source refs, setup commands, and effective copy globs.
- That `.pi/workspace.local.json` is gitignored and is not for commit.

Then explain that `setup-worktree` will create one Git worktree per configured repository, copy the configured local files, run each configured setup command, and start implementation from the primary worktree. If workspace creation is disabled, state which configuration value disables it.
