import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agentUnavailableError } from "../../src/agent-runtime.ts";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("package.json declares the pi manifest surface", async () => {
  const pkg = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"));
  assert.equal(pkg.keywords?.includes("pi-package"), true);
  assert.ok(Array.isArray(pkg.pi.extensions));
  assert.equal(pkg.pi.extensions.includes("./node_modules/pi-subagents/index.ts"), false);
  assert.ok(Array.isArray(pkg.pi.skills));
  assert.ok(Array.isArray(pkg.pi.prompts));
  assert.ok(pkg.files.includes("CHANGELOG.md"));
  assert.deepEqual(pkg.pi.subagents?.agents, ["./agents"]);
  assert.equal(pkg.dependencies?.["pi-subagents"], undefined);
  assert.equal(pkg.bundledDependencies?.includes("pi-subagents") ?? false, false);
  // core packages are peers
  for (const name of [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "typebox",
  ]) {
    assert.ok(pkg.peerDependencies[name], `missing peer ${name}`);
    assert.ok(pkg.devDependencies[name], `missing dev dependency ${name}`);
  }
});

test("changelog has one valid Unreleased heading", async () => {
  const text = await readFile(resolve(pkgRoot, "CHANGELOG.md"), "utf8");
  assert.equal((text.match(/^## Unreleased$/gm) ?? []).length, 1);
  assert.doesNotMatch(text, /^-## Unreleased$/m);
});

test("implementation agents are code-only writer lanes", async () => {
  for (const name of ["artifact-implementer.md", "artifact-outline-implementer.md"]) {
    const text = await readFile(resolve(pkgRoot, "agents", name), "utf8");
    assert.match(text, /^acceptanceRole: writer$/m, `${name}: missing writer acceptance role`);
    assert.doesNotMatch(text.split("---")[1] ?? "", /rpi_update_artifact/, `${name}: exposes artifact mutation in tools`);
    assert.match(text, /authoritative (plan or ticket path|structure-outline path)/i, `${name}: does not require exact source path`);
    assert.match(text, /canonical phase ID|exact `## Phase N: title`/i, `${name}: does not require a canonical phase ID`);
    assert.match(text, /focused automated/i, `${name}: missing focused verification guidance`);
    assert.match(text, /ready for parent verification/i, `${name}: missing parent handoff`);
  }
});

test("authoritative phase templates and runtime skills preserve the implementation contract", async () => {
  const templates = [
    "skills/create-plan/references/plan_template.md",
    "skills/create-structure-outline/references/structure_outline_template.md",
  ];
  for (const file of templates) {
    const text = await readFile(resolve(pkgRoot, file), "utf8");
    assert.match(text, /one observable behavior/i, `${file}: missing phase-size contract`);
    assert.match(text, /focused automated/i, `${file}: missing focused verification contract`);
    assert.match(text, /parent.*(human gate|full repository gate|artifact)/is, `${file}: missing parent ownership contract`);
    assert.equal((text.match(/^## Phase heading convention$/gm) ?? []).length, 1, `${file}: heading convention must be stated once`);
    assert.match(text, /source heading as `## Phase N: title`/i, `${file}: missing parseable source heading`);
    assert.match(text, /heading text `Phase N: title` as `phaseId`/i, `${file}: missing caller phase ID`);
    assert.match(text, /without the leading Markdown `##` or any completion marker/i, `${file}: phase ID permits heading decoration`);
    assert.match(text, /Oneshot ticket callers use `implementation`/i, `${file}: missing oneshot phase ID`);
    assert.equal((text.match(/Canonical phase ID/gi) ?? []).length, 0, `${file}: repeats the convention in a sample phase`);
  }

  for (const file of ["skills/implement-plan/SKILL.md", "skills/implement-outline/SKILL.md"]) {
    const text = await readFile(resolve(pkgRoot, file), "utf8");
    assert.match(text, /one observable behavior/i, `${file}: missing runtime phase-size contract`);
    assert.match(text, /focused automated/i, `${file}: missing focused child verification`);
    assert.match(text, /parent.*full repository gate/is, `${file}: missing parent full gate`);
    assert.match(text, /human gate/i, `${file}: missing human confirmation gate`);
    assert.match(text, /exact absolute task directory and .* path/i, `${file}: missing exact source-path handoff`);
    assert.match(text, /child writes code and reports evidence only/i, `${file}: child ownership is not explicit`);
  }
});

test("installed-runtime smoke documentation preserves lifecycle and ownership checks", async () => {
  const readme = await readFile(resolve(pkgRoot, "README.md"), "utf8");
  assert.match(readme, /docs\/pi-subagents-smoke\.md/);
  const text = await readFile(resolve(pkgRoot, "docs/pi-subagents-smoke.md"), "utf8");
  for (const contract of [
    /Successful run/i,
    /Timeout cleanup/i,
    /Cancellation recovery/i,
    /byte-for-byte unchanged/i,
    /run ID and terminal state/i,
    /no live or orphan run remains/i,
    /never reuse or close a session owned by another user/i,
  ]) assert.match(text, contract);
});

test("skill, agent, and prompt counts match the plan", async () => {
  const { readdir } = await import("node:fs/promises");
  const skills = await readdir(resolve(pkgRoot, "skills"));
  assert.equal(skills.length, 22);
  const agents = await readdir(resolve(pkgRoot, "agents"));
  assert.equal(agents.length, 7);
  const prompts = await readdir(resolve(pkgRoot, "prompts"));
  assert.equal(prompts.length, 7);
});

test("every SKILL.md has valid frontmatter (name + description)", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const names = await readdir(resolve(pkgRoot, "skills"));
  for (const dir of names) {
    const text = await readFile(resolve(pkgRoot, "skills", dir, "SKILL.md"), "utf8");
    assert.match(text, /^---\n/, `${dir}: missing frontmatter`);
    assert.match(text, /^name: /m, `${dir}: missing name`);
    assert.match(text, /^description: /m, `${dir}: missing description`);
    assert.match(text, /^description: ["']/m, `${dir}: description must be quoted`);
  }
});

test("agentUnavailableError explains how package agents become available", () => {
  const err = agentUnavailableError(new Error("Unknown agent: artifact-locator"));
  assert.match(err.message, /pi install npm:pi-subagents/);
  assert.match(err.message, /pi list/);
  // unrelated errors pass through
  const other = agentUnavailableError(new Error("spawn failed: timeout"));
  assert.doesNotMatch(other.message, /only discoverable/);
});
