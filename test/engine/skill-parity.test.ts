import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const UPSTREAM_0_39_0_SKILL_PATHS = [
  "skills/ci-commit/SKILL.md",
  "skills/configure-workspaces/SKILL.md",
  "skills/create-design-discussion/references/design_discussion_final_answer_resolved.md",
  "skills/create-design-discussion/references/design_discussion_final_answer.md",
  "skills/create-design-discussion/references/design_discussion_template.md",
  "skills/create-design-discussion/SKILL.md",
  "skills/create-plan/references/plan_final_answer_disabled.md",
  "skills/create-plan/references/plan_final_answer_in_worktree.md",
  "skills/create-plan/references/plan_final_answer.md",
  "skills/create-plan/references/plan_template.md",
  "skills/create-plan/SKILL.md",
  "skills/create-prd/references/prd_final_answer_resolved.md",
  "skills/create-prd/references/prd_template.md",
  "skills/create-prd/SKILL.md",
  "skills/create-research-questions/references/research_questions_final_answer.md",
  "skills/create-research-questions/references/research_questions_template.md",
  "skills/create-research-questions/SKILL.md",
  "skills/create-research/references/research_final_answer.md",
  "skills/create-research/references/research_template.md",
  "skills/create-research/SKILL.md",
  "skills/create-structure-outline/references/show-me.md",
  "skills/create-structure-outline/references/structure_outline_final_answer_in_worktree.md",
  "skills/create-structure-outline/references/structure_outline_final_answer.md",
  "skills/create-structure-outline/references/structure_outline_template.md",
  "skills/create-structure-outline/SKILL.md",
  "skills/create-tdd/references/artifact_template.html",
  "skills/create-tdd/references/tdd_final_answer_resolved.md",
  "skills/create-tdd/references/tdd_template.md",
  "skills/create-tdd/SKILL.md",
  "skills/describe-pr/references/describe_pr_final_answer.md",
  "skills/describe-pr/references/pr_description_template.md",
  "skills/describe-pr/references/pr_walkthrough_example.html",
  "skills/describe-pr/references/show-me.md",
  "skills/describe-pr/scripts/inject-walkthrough-diffs.sh",
  "skills/describe-pr/SKILL.md",
  "skills/implement-outline/references/implement_outline_final_answer.md",
  "skills/implement-outline/SKILL.md",
  "skills/implement-plan/references/implement_plan_final_answer.md",
  "skills/implement-plan/SKILL.md",
  "skills/iterate-design-discussion/references/design_discussion_final_answer_resolved.md",
  "skills/iterate-design-discussion/references/design_discussion_final_answer.md",
  "skills/iterate-design-discussion/SKILL.md",
  "skills/iterate-implementation/references/iterate_implementation_final_answer.md",
  "skills/iterate-implementation/SKILL.md",
  "skills/iterate-plan/references/plan_final_answer_disabled.md",
  "skills/iterate-plan/references/plan_final_answer_in_worktree.md",
  "skills/iterate-plan/references/plan_final_answer.md",
  "skills/iterate-plan/SKILL.md",
  "skills/iterate-prd/references/prd_final_answer_resolved.md",
  "skills/iterate-prd/SKILL.md",
  "skills/iterate-research-questions/references/research_questions_final_answer.md",
  "skills/iterate-research-questions/SKILL.md",
  "skills/iterate-research/references/research_final_answer.md",
  "skills/iterate-research/SKILL.md",
  "skills/iterate-structure-outline/references/structure_outline_final_answer_in_worktree.md",
  "skills/iterate-structure-outline/references/structure_outline_final_answer.md",
  "skills/iterate-structure-outline/SKILL.md",
  "skills/iterate-tdd/references/artifact_template.html",
  "skills/iterate-tdd/references/tdd_final_answer_resolved.md",
  "skills/iterate-tdd/SKILL.md",
  "skills/review-artifact-comments/references/comment_xml_format.md",
  "skills/review-artifact-comments/SKILL.md",
  "skills/setup-worktree/SKILL.md",
];
const UPSTREAM_0_39_0_ASSET_SHA256 = new Map([
  ["skills/create-design-discussion/references/design_discussion_final_answer_resolved.md", "67d66f1c16d8080b9bb304579378964538a074bcfc0cc49d8dd6d5a2e17c28c0"],
  ["skills/create-design-discussion/references/design_discussion_final_answer.md", "35f5431b34047f18a93a7a7225bc964022756991775d6bb0f45d46ca370ec358"],
  ["skills/create-design-discussion/references/design_discussion_template.md", "0e2ebd0eb4c12b1f8f55d8577c54f2c88c4af6dd9f5da86424e2cfdd85556d0d"],
  ["skills/create-plan/references/plan_final_answer_disabled.md", "8ba134c9ff62b0a726a3795b68d8f5ab54d2fe7afa7825a0391515b642e9af98"],
  ["skills/create-plan/references/plan_final_answer_in_worktree.md", "e9abe37289acb89c96fb3fcde121a4891a4fb1aa364b4cd7d0c80b51fa548ecd"],
  ["skills/create-plan/references/plan_final_answer.md", "2e2b0e4aba22a759616f3915d45a3944ff26fe04c21394ab2de822c12709b399"],
  ["skills/create-plan/references/plan_template.md", "a59f1f6942d316e4b55eba90d1b7ab9fe1eca9e30c23249d647ad603788ae60c"],
  ["skills/create-prd/references/prd_final_answer_resolved.md", "2a290ff848e2e2ffc8b0312601965a1e52a6cccc9f26e89fbd0d20fc9b5e3fe4"],
  ["skills/create-prd/references/prd_template.md", "74682dd4098682a2485efee745f5ee302c2d512c985e78f4e6f5e9814bdc998e"],
  ["skills/create-research-questions/references/research_questions_final_answer.md", "5733bf60147abc290db8f687f571797f03682b2542efab7d70bfb90dd4298ee7"],
  ["skills/create-research-questions/references/research_questions_template.md", "66f0a6d9f78153df2e19bd5171ab7c978e1bed529187e343f7cfbb99568bc06c"],
  ["skills/create-research/references/research_final_answer.md", "276a72ebec6a211b15e79290b76739e55df20f91daad957ba7478162af27c222"],
  ["skills/create-research/references/research_template.md", "b4255e0f3855cdcffd6e36e0d8ba2f8b0c19a6d4aa6591c6fdfe79f934d075b1"],
  ["skills/create-structure-outline/references/show-me.md", "968f25af5bce778c06826f5bc4540631c3eab3e067be0fe48b48552cc1664a1f"],
  ["skills/create-structure-outline/references/structure_outline_final_answer_in_worktree.md", "11279514ae76a9c693fa32f3b9f356c29c984966dc0d1943c29adb89fc6049c8"],
  ["skills/create-structure-outline/references/structure_outline_final_answer.md", "8fdd59abb81bf549b81565cffd5426a2c5e890a8e60402ad72e2d2421488f47f"],
  ["skills/create-structure-outline/references/structure_outline_template.md", "f3009d48c4465bc26e316776d39efa851981eae9e268d139ddba0306c0669d81"],
  ["skills/create-tdd/references/artifact_template.html", "6cfede6fa2e84c4b3663a51ad91c9093e22f4e3d0851d1b9ec9863266b08ea7f"],
  ["skills/create-tdd/references/tdd_final_answer_resolved.md", "0d80f9878f75de4b1ad0cf414e1d20390ca216a10a55ca9ac11516133bb63faa"],
  ["skills/create-tdd/references/tdd_template.md", "9987392e825cb838bb3d505396ccd341c62515cab64a65d5af8155a75c5c4ccf"],
  ["skills/describe-pr/references/describe_pr_final_answer.md", "092289f1b5bda63d17661f6957787020d9f7cb377d9cd93152167c0ae0f202a0"],
  ["skills/describe-pr/references/pr_description_template.md", "400c07b66447ed94b9ae6a496385bbb7c18041685cc5aa7b44385889e0adf2a2"],
  ["skills/describe-pr/references/pr_walkthrough_example.html", "fd254db8213cf2f912966a22d7449d05a73b3997aed10de680f1a19f19d24357"],
  ["skills/describe-pr/references/show-me.md", "968f25af5bce778c06826f5bc4540631c3eab3e067be0fe48b48552cc1664a1f"],
  ["skills/describe-pr/scripts/inject-walkthrough-diffs.sh", "5a1d25c81908380fb08c879bc0d5c9209b46848a94de774e4d60aa88c49881ca"],
  ["skills/implement-outline/references/implement_outline_final_answer.md", "b2a8babd08a0a5440d4b16b3c15d207e0df9c42acad5c6d720b039d591ebf197"],
  ["skills/implement-plan/references/implement_plan_final_answer.md", "38efedd4d609636ca979a05751e6ee02b14fe889d1d4cd91c74f246984fd3ced"],
  ["skills/iterate-design-discussion/references/design_discussion_final_answer_resolved.md", "67d66f1c16d8080b9bb304579378964538a074bcfc0cc49d8dd6d5a2e17c28c0"],
  ["skills/iterate-design-discussion/references/design_discussion_final_answer.md", "35f5431b34047f18a93a7a7225bc964022756991775d6bb0f45d46ca370ec358"],
  ["skills/iterate-implementation/references/iterate_implementation_final_answer.md", "e309a2e70fd4cfe2d16bb2fac4fb18ca49193fa31ae7cd076c17f2a5627b7e1c"],
  ["skills/iterate-plan/references/plan_final_answer_disabled.md", "8ba134c9ff62b0a726a3795b68d8f5ab54d2fe7afa7825a0391515b642e9af98"],
  ["skills/iterate-plan/references/plan_final_answer_in_worktree.md", "e9abe37289acb89c96fb3fcde121a4891a4fb1aa364b4cd7d0c80b51fa548ecd"],
  ["skills/iterate-plan/references/plan_final_answer.md", "b8d6e67ca45238ff63b1263209d54ddafd58cbd5b32fff8defdd81556ca71d2c"],
  ["skills/iterate-prd/references/prd_final_answer_resolved.md", "2a290ff848e2e2ffc8b0312601965a1e52a6cccc9f26e89fbd0d20fc9b5e3fe4"],
  ["skills/iterate-research-questions/references/research_questions_final_answer.md", "5733bf60147abc290db8f687f571797f03682b2542efab7d70bfb90dd4298ee7"],
  ["skills/iterate-research/references/research_final_answer.md", "fdb70b047b495ec5fd93239822df98dd859b76518351f2a357551cf06a3d44d2"],
  ["skills/iterate-structure-outline/references/structure_outline_final_answer_in_worktree.md", "11279514ae76a9c693fa32f3b9f356c29c984966dc0d1943c29adb89fc6049c8"],
  ["skills/iterate-structure-outline/references/structure_outline_final_answer.md", "8fdd59abb81bf549b81565cffd5426a2c5e890a8e60402ad72e2d2421488f47f"],
  ["skills/iterate-tdd/references/artifact_template.html", "6cfede6fa2e84c4b3663a51ad91c9093e22f4e3d0851d1b9ec9863266b08ea7f"],
  ["skills/iterate-tdd/references/tdd_final_answer_resolved.md", "0d80f9878f75de4b1ad0cf414e1d20390ca216a10a55ca9ac11516133bb63faa"],
  ["skills/review-artifact-comments/references/comment_xml_format.md", "60b8afc963c72fc7c357ca272de67721ce4f0f3e8e13fc887c51f75b2ddae5ac"],
]);

const INTENTIONALLY_PI_ADAPTED_ASSET_PATHS = new Set([
  "skills/create-plan/references/plan_final_answer_disabled.md",
  "skills/iterate-plan/references/plan_final_answer_disabled.md",
  "skills/create-prd/references/prd_template.md",
  "skills/create-structure-outline/references/show-me.md",
  "skills/describe-pr/references/describe_pr_final_answer.md",
  "skills/describe-pr/references/pr_description_template.md",
  "skills/describe-pr/references/show-me.md",
  "skills/create-plan/references/plan_template.md",
  "skills/create-structure-outline/references/structure_outline_template.md",
]);


const PI_EXTENSION_TOOL_NAMES = new Set([
  "rpi_read_artifact",
  "rpi_create_artifact",
  "rpi_update_artifact",
  "rpi_get_task_context",
  "rpi_list_artifacts",
  "rpi_start_research",
  "rpi_implement_phase",
  "rpi_record_phase_commit",
  "rpi_review_implementation",
  "rpi_git_diff",
  "rpi_create_task",
  "rpi_set_artifact_status",
]);

const OPTIONAL_CONDITIONAL_PROBES = new Set([
  "skills/setup-worktree/scripts/create_worktree.sh",
]);

async function collectFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(path, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }));
  return files.flat();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("packaged skills retain the upstream 0.39.0 inventory and Pi-native contracts", async () => {
  const pkg = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("skills"), "package files must include the skills root");
  assert.ok(pkg.pi.skills.includes("./skills"), "Pi manifest must include the skills root");

  const skillFiles = await collectFiles(resolve(pkgRoot, "skills"));
  const relativeSkillFiles = skillFiles.map((path) => relative(pkgRoot, path)).sort();
  assert.equal(UPSTREAM_0_39_0_SKILL_PATHS.length, 63);
  assert.deepEqual(relativeSkillFiles, [...UPSTREAM_0_39_0_SKILL_PATHS].sort());
  assert.equal(UPSTREAM_0_39_0_ASSET_SHA256.size, 41);
  const assetPaths = relativeSkillFiles.filter((path) => !path.endsWith("/SKILL.md"));
  assert.deepEqual(assetPaths, [...UPSTREAM_0_39_0_ASSET_SHA256.keys()].sort());
  for (const [assetPath, expectedHash] of UPSTREAM_0_39_0_ASSET_SHA256) {
    if (INTENTIONALLY_PI_ADAPTED_ASSET_PATHS.has(assetPath)) continue;
    const bytes = await readFile(resolve(pkgRoot, assetPath));
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actualHash, expectedHash, `${assetPath}: SHA-256 mismatch`);
  }

  for (const skillPath of relativeSkillFiles) {
    const text = await readFile(resolve(pkgRoot, skillPath), "utf8");
    assert.doesNotMatch(text, /\bhumanlayer\b/i, `${skillPath}: contains a HumanLayer reference`);
  }

  const skillPaths = relativeSkillFiles.filter((path) => path.endsWith("/SKILL.md"));
  for (const skillPath of skillPaths) {
    const absoluteSkillPath = resolve(pkgRoot, skillPath);
    const text = await readFile(absoluteSkillPath, "utf8");
    const usedToolNames = [...text.matchAll(/\brpi_[a-z0-9_]+\b/g)].map((match) => match[0]);
    const unknownToolNames = [...new Set(usedToolNames.filter((name) => !PI_EXTENSION_TOOL_NAMES.has(name)))].sort();
    assert.deepEqual(unknownToolNames, [], `${skillPath}: uses unknown RPI tools`);

    assert.doesNotMatch(text, /`(?:claude|humanlayer)(?:\s|`)/i, `${skillPath}: contains a legacy runtime command`);
    assert.doesNotMatch(text, /(?:^|\n)\s*(?:[$>]\s*)?(?:claude|humanlayer)(?:\s|$)/im, `${skillPath}: contains a legacy runtime command`);
    assert.doesNotMatch(text, /\b(?:Agent|Task|Read|Write|Edit|MultiEdit)\s*\(/, `${skillPath}: contains a legacy executable tool form`);

    for (const line of text.split("\n")) {
      for (const match of line.matchAll(/(?:(?:skills\/[a-z0-9-]+\/)?(?:references|scripts)\/[a-zA-Z0-9._/-]+)/g)) {
        const namedPath = match[0];
        const resourcePath = namedPath.startsWith("skills/")
          ? resolve(pkgRoot, namedPath)
          : resolve(dirname(absoluteSkillPath), namedPath);
        const relativeResourcePath = relative(pkgRoot, resourcePath);

        if (OPTIONAL_CONDITIONAL_PROBES.has(relativeResourcePath)) {
          assert.match(line, /\bwhen it exists\b/, `${skillPath}: optional probe must stay conditional`);
          continue;
        }

        assert.equal(await exists(resourcePath), true, `${skillPath}: named resource ${namedPath} does not exist`);
      }
    }
  }
});

test("execution skills preserve authorization and managed-artifact boundaries", async () => {
  const readPkgFile = (path: string) => readFile(resolve(pkgRoot, path), "utf8");
  const [locator, analyzer, commit, setup, describePr, implementPlan, implementOutline] = await Promise.all([
    readPkgFile("agents/artifact-locator.md"),
    readPkgFile("agents/artifact-analyzer.md"),
    readPkgFile("skills/ci-commit/SKILL.md"),
    readPkgFile("skills/setup-worktree/SKILL.md"),
    readPkgFile("skills/describe-pr/SKILL.md"),
    readPkgFile("skills/implement-plan/SKILL.md"),
    readPkgFile("skills/implement-outline/SKILL.md"),
  ]);

  assert.match(locator, /filename and file-glob patterns/i);
  assert.doesNotMatch(locator, /keyword grep/i);
  assert.match(analyzer, /truncat(?:ed|ion)[\s\S]*offset/i);

  assert.match(setup, /disable-model-invocation:\s*true/);
  assert.doesNotMatch(commit, /disable-model-invocation:\s*true/);
  assert.match(commit, /explicit commit authorization/i);
  assert.match(commit, /Loading this skill does not authorize a commit/i);
  assert.match(commit, /source and regression tests/i);
  assert.doesNotMatch(commit, /Never stage generated, dummy, test-only/);
  assert.match(implementPlan, /confirm[\s\S]*authorize[\s\S]*commit/i);
  assert.match(implementOutline, /confirm[\s\S]*authorize[\s\S]*commit/i);

  assert.doesNotMatch(describePr, /skills\/describe-pr\/(?:references|scripts)\//);
  assert.match(describePr, /explicit user authorization[\s\S]*commit, push, or PR creation/i);
  assert.match(describePr, /existing active `pr-walkthrough`[\s\S]*rpi_update_artifact/i);
  assert.match(describePr, /rpi_read_artifact[\s\S]*disposable temporary copy/i);
  assert.match(describePr, /absolute script path[\s\S]*implementation repository/i);
  assert.match(describePr, /disposable temporary copy/i);
  assert.match(describePr, /rpi_update_artifact/);
  assert.match(describePr, /existing `pr-description`[\s\S]*rpi_update_artifact/i);
});
