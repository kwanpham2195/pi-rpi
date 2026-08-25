# Upstream RPI Skill Parity Plan

Date: 2026-08-24
Status: complete
Scope: restore upstream RPI 0.39.0 skill workflow material in Pi form without overwriting current, uncommitted Pi work.

## Completion record

- Restored the 41 parity source assets and their owning Pi-mapped skill instructions; the packaged `skills/` tree now has the 63-path upstream 0.39.0 inventory.
- Regression proof pins every imported asset's SHA-256 bytes and rejects legacy Claude, HumanLayer, and executable tool forms while allowing registered `rpi_*` tools.
- Known residual risk: upstream-text reference guidance can need future Pi-specific wording review; no runtime or package behavior remains unported.

## Verified audit facts

- Upstream source is `/Users/kwanpham/.humanlayer/riptide/plugins/riptide-rpi/0.39.0/`; its `.claude-plugin/plugin.json` identifies version `0.39.0`.
- The skills audit compared 63 unique skill files: 22 local files and 63 upstream files. No local `SKILL.md` is byte-identical to its upstream counterpart.
- All local skill files are shorter or otherwise altered from upstream. The audit identifies deliberate Pi/RPI adaptation as the dominant change, but does not prove that every omitted upstream paragraph is intentionally absent.
- The skills audit identifies the 41 files below as present upstream and absent locally. They are reference templates, final-answer formats, HTML assets, visual guidance, or a shell script.
- The assets audit records 39 files while enumerating this area; the skills audit is the authoritative inventory for this plan because the requested contract requires 41 exact files. Reconcile the two audit counts before accepting implementation, and preserve the 41-path inventory below unless a source comparison disproves a path.
- `package.json` is Pi's discovery manifest: `pi.skills` registers `./skills`, `pi.prompts` registers `./prompts`, and `pi.subagents.agents` registers `./agents`. Its supported checks are `npm run typecheck` and `npm test`.
- Pi-only adaptation assets are intentional mappings, not upstream omissions: seven prompt files under `prompts/` and seven agent files under `agents/`. Upstream's Claude plugin manifest has no matching prompt or agent exports.

## Intentional mappings, distinct from missing content

Keep these Pi-native concepts and replace upstream equivalents with them during restoration:

- `rpi_read_artifact`, `rpi_create_artifact`, `rpi_update_artifact`, `rpi_start_research`, `rpi_implement_phase`, `rpi_review_implementation`, and `rpi_git_diff` replace Claude `Read`, `Write/Edit/MultiEdit`, `Task`/`Agent()`, and HumanLayer MCP calls.
- `.pi/artifacts/` manifests and artifact IDs replace `.humanlayer/tasks/`, `task.md`, `ticket.md`, and cloud artifact permalinks.
- Registered `prompts/` and `agents/` files replace upstream inline Claude prompts and subagent invocations.
- `package.json` Pi fields replace the upstream `.claude-plugin/plugin.json` discovery model.

The following are missing upstream format content, not proof that the Pi mapping is wrong: sibling `references/` files loaded by `SKILLBASE`, `show-me.md` visual conventions, HTML templates, final-answer files, and the PR walkthrough injection script.

## Required Pi-native porting rule

For each restored skill, retain the upstream behavioral sequence, decisions, artifact/template structure, completion conditions, and required-output format. Replace only Claude/HumanLayer-specific tools, agents, artifact paths, manifests, and plugin assumptions with existing Pi RPI tools, registered prompts/agents, and `.pi` artifact manifests. Do not copy `Agent()`, `Task`, HumanLayer MCP commands, `.humanlayer` paths, or Claude tool calls verbatim. If an upstream asset has no usable Pi equivalent, port its format/content and document the explicit Pi runtime mapping in the owning `SKILL.md`; do not silently remove the behavior.

## Exact missing upstream files (41)

1. `skills/create-design-discussion/references/design_discussion_final_answer.md`
2. `skills/create-design-discussion/references/design_discussion_final_answer_resolved.md`
3. `skills/create-design-discussion/references/design_discussion_template.md`
4. `skills/create-plan/references/plan_final_answer.md`
5. `skills/create-plan/references/plan_final_answer_disabled.md`
6. `skills/create-plan/references/plan_final_answer_in_worktree.md`
7. `skills/create-plan/references/plan_template.md`
8. `skills/create-prd/references/prd_final_answer_resolved.md`
9. `skills/create-prd/references/prd_template.md`
10. `skills/create-research-questions/references/research_questions_final_answer.md`
11. `skills/create-research-questions/references/research_questions_template.md`
12. `skills/create-research/references/research_final_answer.md`
13. `skills/create-research/references/research_template.md`
14. `skills/create-structure-outline/references/show-me.md`
15. `skills/create-structure-outline/references/structure_outline_final_answer.md`
16. `skills/create-structure-outline/references/structure_outline_final_answer_in_worktree.md`
17. `skills/create-structure-outline/references/structure_outline_template.md`
18. `skills/create-tdd/references/artifact_template.html`
19. `skills/create-tdd/references/tdd_final_answer_resolved.md`
20. `skills/create-tdd/references/tdd_template.md`
21. `skills/describe-pr/references/describe_pr_final_answer.md`
22. `skills/describe-pr/references/pr_description_template.md`
23. `skills/describe-pr/references/pr_walkthrough_example.html`
24. `skills/describe-pr/references/show-me.md`
25. `skills/describe-pr/scripts/inject-walkthrough-diffs.sh`
26. `skills/implement-outline/references/implement_outline_final_answer.md`
27. `skills/implement-plan/references/implement_plan_final_answer.md`
28. `skills/iterate-design-discussion/references/design_discussion_final_answer.md`
29. `skills/iterate-design-discussion/references/design_discussion_final_answer_resolved.md`
30. `skills/iterate-implementation/references/iterate_implementation_final_answer.md`
31. `skills/iterate-plan/references/plan_final_answer.md`
32. `skills/iterate-plan/references/plan_final_answer_disabled.md`
33. `skills/iterate-plan/references/plan_final_answer_in_worktree.md`
34. `skills/iterate-prd/references/prd_final_answer_resolved.md`
35. `skills/iterate-research-questions/references/research_questions_final_answer.md`
36. `skills/iterate-research/references/research_final_answer.md`
37. `skills/iterate-structure-outline/references/structure_outline_final_answer.md`
38. `skills/iterate-structure-outline/references/structure_outline_final_answer_in_worktree.md`
39. `skills/iterate-tdd/references/artifact_template.html`
40. `skills/iterate-tdd/references/tdd_final_answer_resolved.md`
41. `skills/review-artifact-comments/references/comment_xml_format.md`

## Current work to preserve

These twelve modified skill files are uncommitted current work. Do not reset, replace wholesale, or overwrite them. Restore missing upstream behavior by applying the porting rule around their current Pi changes, then review the combined diff with their current owner.

- `skills/create-design-discussion/SKILL.md`
- `skills/create-plan/SKILL.md`
- `skills/create-prd/SKILL.md`
- `skills/create-research-questions/SKILL.md`
- `skills/create-research/SKILL.md`
- `skills/create-structure-outline/SKILL.md`
- `skills/create-tdd/SKILL.md`
- `skills/describe-pr/SKILL.md`
- `skills/implement-outline/SKILL.md`
- `skills/implement-plan/SKILL.md`
- `skills/iterate-design-discussion/SKILL.md`
- `skills/review-artifact-comments/SKILL.md`

## Serial implementation phases

### 1. Establish source and ownership baseline

1. Record `git status --short`, confirm no files are staged, and capture the current diffs for the twelve protected skills.
2. Compare the upstream 0.39.0 file list with the local `skills/` file list. Reconcile the audit count discrepancy and confirm the 41 required paths before copying anything.
3. For each affected skill, map upstream reference reads and behaviors to existing RPI tools, prompt registrations, agent registrations, and manifest fields. Stop for approval if the map requires a new runtime tool or a change to an existing public artifact format.

### 2. Import reference and script source material

1. Add the confirmed 41 upstream-only paths under the same local `skills/` relative paths.
2. Preserve format-bearing content during import: Markdown templates, final-answer text, `show-me.md`, HTML templates/examples, XML format instructions, and the walkthrough script.
3. Do not mark imported content as ready for Claude; the following phase owns Pi conversion. Keep source provenance in the implementation commit or plan notes, not as speculative runtime instructions.

### 3. Restore each skill's behavior without losing Pi work

1. Work one skill family at a time, beginning with `create-research`, `create-structure-outline`, `create-tdd`, and `describe-pr`, because they expose the highest-impact template, visual, and walkthrough gaps.
2. Restore omitted upstream behavioral steps and direct each skill to its local reference assets where Pi needs the source format.
3. Apply the Pi-native porting rule to every restored instruction. Keep the twelve protected skill diffs intact; merge additions narrowly rather than replacing whole files from upstream.
4. Continue with create/iterate pairs and implementation/review skills until all required templates and final-answer formats have an owning Pi workflow.

### 4. Adapt assets and package-facing behavior

1. Convert Claude/HumanLayer tool calls, task paths, and cloud comment behavior in imported template instructions to existing RPI commands and `.pi` manifests.
2. Map visual and HTML material to Pi artifact rendering/diagram behavior. Map the walkthrough script to Pi's `rpi_git_diff`/local artifact flow, or keep it as a Pi-invocable script only if its inputs and output contract work unchanged.
3. Use existing `prompts/` and `agents/` registrations for delegated behavior. Update package discovery metadata only if the implementation adds a new discoverable root; do not add a Claude plugin manifest.

### 5. Add proof, user documentation, and release record

1. Add focused tests that load the package manifest and verify every restored reference/script path required by a Pi skill exists and is package-included.
2. Add static regression checks that fail on stale `HumanLayer`, `.humanlayer`, `Agent()`, `Task`, and Claude-tool commands in Pi runtime skill instructions, while allowing factual provenance only where explicitly necessary.
3. Update README documentation for user-visible restored skill outputs and Pi-native behavior. Add one changelog entry that states the restored parity surface.
4. Run the full verification sequence and inspect the final diff for accidental edits to unrelated current work.

## Verification

Run these checks after each relevant phase and again before handoff:

```sh
cd /Users/kwanpham/Work/pi-rpi
git status --short
git diff --cached --name-only
comm -23 \
  <(cd /Users/kwanpham/.humanlayer/riptide/plugins/riptide-rpi/0.39.0 && find skills -type f | sort) \
  <(find skills -type f | sort)
rg -n -i 'HumanLayer|\.humanlayer|\bAgent\(\)|\bTask\b|\b(Read|Write|Edit|MultiEdit)\(' skills
node -e "const p=require('./package.json'); for (const key of ['extensions','skills','prompts']) if (!p.pi?.[key]?.length) throw new Error('missing pi.' + key); if (!p.pi?.subagents?.agents?.length) throw new Error('missing pi.subagents.agents'); console.log('Pi package discovery manifest is complete')"
npm run typecheck
npm test
```

Expected source-parity result: no missing required paths after the 41-path source inventory has been reconciled; any intentional non-port must be named and approved. Expected stale-command result: no executable Claude/HumanLayer command or path in Pi skill behavior. Package discovery is proven by the manifest assertion and a package-loading test. TypeScript and test gates use the current `package.json` scripts.

## Risks and controls

- High: copying upstream instructions without conversion can introduce unusable Claude/HumanLayer commands. Control: enforce the porting rule and stale-command regression test.
- High: wholesale restores can erase the twelve uncommitted Pi skill changes. Control: preserve their diffs first, edit narrowly, and review combined diffs with the current owner.
- High: template imports can become runtime blockers if a skill references them with an invalid Pi path. Control: path-existence and package-inclusion tests.
- Medium: `show-me.md`, HTML templates, and `inject-walkthrough-diffs.sh` have no confirmed Pi runtime equivalent. Control: spike each asset against existing RPI artifact/rendering support; request approval before adding new tooling or degrading behavior.
- Medium: audit totals conflict (39 in the assets audit, 41 in the skills audit). Control: source-list comparison is a phase-1 acceptance gate.
- Medium: package identity/version differs from upstream (`pi-rpi` `0.1.0` versus upstream plugin `rpi` `0.39.0`). This plan does not change identity or version; confirm release policy separately.
- Low: upstream Claude plugin metadata and LICENSE are outside skill execution parity. Do not add them without an explicit packaging decision.
