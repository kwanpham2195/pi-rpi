# Changelog

## Unreleased
- Replaced stale HumanLayer paths and links in packaged skill templates with Pi artifact and workspace references.
- Cleared unavailable persisted task selections before they can inject agent context or run task tools.
- Fixed failed agent-run rendering, task-footer clearing after tree navigation, per-turn task context, and full-output recovery for truncated results.
- Added persistent task selection, durable task status reports, and live queued/running updates for research, implementation, and review runs.
- Required Pi 0.84.4 or newer for RPI's durable TUI entry renderers.

- Create new tickets as `ticket.md` and new artifacts as `NN-<type>-<description>.md`.
- Restored Pi-native upstream skill templates and guidance.
- Show the active task's flow, next stage, and review count in Pi's footer.
- Updated `/rpi-init` to create the default shared workspace configuration and ignore local workspace overrides.
- Fixed task safety, agent runtime integration, receipt tracking, and guarded staging behavior.
- Added intent-first task creation with flow selection, task and artifact selectors, Git base-branch selection, and active-task Plannotator annotation.
- Required a separately installed `pi-subagents` package for agent-run tools.
- Returned active-task Plannotator annotation feedback to the active agent for follow-up.
