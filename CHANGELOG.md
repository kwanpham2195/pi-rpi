# Changelog

## Unreleased
- Validated manifests before artifact writes and recovered owned files on persistence failures without hiding rollback evidence.
- Improved agent-run status recovery for well-formed snapshots that omit the owned run while retaining strict malformed-state failures.
- Shared one authoritative task artifact root across configured worktrees and kept superseded history from blocking valid flow changes.
- Added optional `pr-walkthrough` support to standard flows and clarified implementation, worktree, review, commit, and provider-loading instructions.
- Included linked runtime smoke documentation in the npm package.
- Increased research and review agent-run defaults to 10 minutes and implementation defaults to 20 minutes.
- Corrected pi-subagents implementation and review launches to use direct child runs with authoritative task context, owned timeout cleanup, and live activity progress.
- Replaced stale HumanLayer paths and links in packaged skill templates with Pi artifact and workspace references.
- Cleared unavailable persisted task selections before they can inject agent context or run task tools.
- Fixed failed agent-run rendering, task-footer clearing after tree navigation, per-turn task context, and full-output recovery for truncated results.
- Added persistent task selection, durable task status reports, and live queued/running updates for research, implementation, and review runs.
- Required Pi 0.84.4 or newer for RPI's durable TUI entry renderers.
- Normalized human artifact descriptions into safe kebab-case filenames and required approved dependencies before creating downstream artifacts.
- Added configurable implementation phase timeouts and failure details for non-success terminal states.
- Supported generic mode in creation skills so documents work with or without an RPI task.

- Create new tickets as `ticket.md` and new artifacts as `NN-<type>-<description>.md`.
- Restored Pi-native upstream skill templates and guidance.
- Show the active task's flow, next stage, and review count in Pi's footer.
- Updated `/rpi-init` to create the default shared workspace configuration and ignore local workspace overrides.
- Fixed task safety, agent runtime integration, receipt tracking, and guarded staging behavior.
- Added intent-first task creation with flow selection, task and artifact selectors, Git base-branch selection, and active-task Plannotator annotation.
- Required a separately installed `pi-subagents` package for agent-run tools.
- Returned active-task Plannotator annotation feedback to the active agent for follow-up.
