---
name: configure-workspaces
description: "Writes the .pi/workspace.json and .pi/workspace.local.json worktree config for a project. Use when the user wants to set up or change task worktree behavior, including multi-repo setups."
---

# Configure Workspaces

Propose and write the worktree config used by `setup-worktree`.

## Process

1. If not in a git repo, ask which repo to configure. Detect repo layout: `git remote -v`, `git rev-parse --show-toplevel`, package manifests, README.
2. Build a proposal:
   - Single-repo default: `repos: [{ localPath: ".", primary: true }]`.
   - Multi-repo: exactly one primary; prefer the repo with the central agent config as primary.
   - Default `pathTemplate` and `sourceRef: "HEAD"`; infer `setupCommand` from the repo; `copyGlobs` from local files present.
   - If no workspace.json exists, write the default shape (as in `setup-worktree`).
3. Show the proposed JSON as a fenced block and ask the user to approve or change it. Do not write until approved.
4. On approval, write `.pi/workspace.json` (committed) and `.pi/workspace.local.json` (gitignored), and append `.pi/workspace.local.json` to `.gitignore` if missing.
5. Summarize the config and next steps. Teams commit `workspace.json` and never `workspace.local.json`.

## Rules

- `copyGlobs` entries merge additively across files with de-dup; they are never wholesale replaced by the local file.
- `disabled: true` at the root disables worktree creation.
- Repo entries override `sourceRef`, `setupCommand`, `copyGlobs`, and `primary`; `branchTemplate` is root-only.
- Effective config = defaults → workspace.json → workspace.local.json.

## Final response

Report the written config paths and the effective worktree behavior.
