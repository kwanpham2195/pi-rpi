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
  }
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
