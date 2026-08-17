import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EngineError,
  changeFlow,
  createArtifact,
  createTask,
  loadManifest,
  nextIndex,
  openTask,
  resolvePrecedence,
  setArtifactStatus,
  updateArtifact,
  validateSlug,
  hashFile,
  safeRelativePath,
  ensureWithin,
} from "../../src/engine/engine.ts";
import { isTypeEnabled } from "../../src/engine/types.ts";

async function mkTmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "rpi-engine-"));
  return d;
}

test("validateSlug accepts kebab-case and rejects bad input", () => {
  assert.doesNotThrow(() => validateSlug("eng-1478-parent-child"));
  assert.throws(() => validateSlug("Eng-1478"), EngineError);
  assert.throws(() => validateSlug("leading-"), EngineError);
  assert.throws(() => validateSlug("-leading"), EngineError);
  assert.throws(() => validateSlug("a--b"), EngineError);
  assert.throws(() => validateSlug("has space"), EngineError);
});

test("nextIndex allocates gaps correctly", () => {
  assert.equal(nextIndex([]), 1);
  assert.equal(nextIndex(["01-a.md"]), 2);
  assert.equal(nextIndex(["01-a.md", "02-b.md", "03-c.md"]), 4);
  // gap: missing 02
  assert.equal(nextIndex(["01-a.md", "03-c.md"]), 4); // next after highest
  // non-prefixed files don't affect the counter
  assert.equal(nextIndex(["ticket.md", "01-a.md"]), 2);
  // two-digit wraps
  assert.equal(nextIndex(["10-a.md"]), 11);
});

test("isTypeEnabled respects flow chains", () => {
  // rpi flow: prd/tdd NOT enabled; research-questions, design-discussion enabled
  assert.equal(isTypeEnabled("rpi", "prd"), false);
  assert.equal(isTypeEnabled("rpi", "tdd"), false);
  assert.equal(isTypeEnabled("rpi", "research-questions"), true);
  assert.equal(isTypeEnabled("rpi", "design-discussion"), true);
  assert.equal(isTypeEnabled("rpi", "structure-outline"), true);
  // prd flow: design-discussion NOT enabled; prd/tdd enabled
  assert.equal(isTypeEnabled("prd", "design-discussion"), false);
  assert.equal(isTypeEnabled("prd", "prd"), true);
  assert.equal(isTypeEnabled("prd", "tdd"), true);
  // oneshot: only ticket/implementation/pr-description/mockup/diagram
  assert.equal(isTypeEnabled("oneshot", "research"), false);
  assert.equal(isTypeEnabled("oneshot", "structure-outline"), false);
  assert.equal(isTypeEnabled("oneshot", "implementation"), true);
  // freeform: everything
  assert.equal(isTypeEnabled("freeform", "research"), true);
  assert.equal(isTypeEnabled("freeform", "tdd"), true);
});

test("createTask writes manifest and ticket atomically, idempotent reopen", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "eng-1478-parent-child",
    title: "Parent child tracking",
    flow: "rpi",
    baseBranch: "main",
    ticketBody: "# Ticket\n\nDo the thing.\n",
  });
  assert.equal(m.flow, "rpi");
  assert.equal(m.artifacts.length, 1);
  assert.equal(m.artifacts[0]?.type, "ticket");
  assert.equal(m.artifacts[0]?.status, "approved");
  // idempotent: re-open returns same manifest
  const m2 = await createTask(base, {
    slug: "eng-1478-parent-child",
    title: "Parent child tracking",
    flow: "rpi",
    baseBranch: "main",
  });
  assert.equal(m2.artifacts.length, 1); // not duplicated
  await rm(base, { recursive: true, force: true });
});

test("createArtifact assigns chronological NN names and validates flow", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "auth-flow",
    title: "Auth flow",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "auth-flow");

  const r1 = await createArtifact(taskDir, m, {
    type: "research-questions",
    description: "current-state",
    content: "# Questions\n",
  });
  assert.equal(r1.artifact.path, "01-current-state.md");

  const r2 = await createArtifact(taskDir, m, {
    type: "research",
    description: "auth-current",
    content: "# Research\n",
    dependsOn: ["research-questions"],
  });
  assert.equal(r2.artifact.path, "02-auth-current.md");

  // prd not enabled in rpi flow
  await assert.rejects(
    createArtifact(taskDir, m, { type: "prd", description: "unused", content: "" }),
    /not enabled in flow/,
  );
  await rm(base, { recursive: true, force: true });
});

test("createArtifact validates dependencies", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "dep-test",
    title: "Dep",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "dep-test");
  await assert.rejects(
    createArtifact(taskDir, m, {
      type: "research",
      description: "x",
      content: "",
      dependsOn: ["does-not-exist"],
    }),
    /does not exist/,
  );
  await rm(base, { recursive: true, force: true });
});

test("updateArtifact updates content hash", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "hash-test",
    title: "Hash",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "hash-test");
  const r = await createArtifact(taskDir, m, {
    type: "research",
    description: "x",
    content: "v1",
  });
  const h1 = r.artifact.contentHash;
  const updated = await updateArtifact(taskDir, m, "research", "v2 longer");
  assert.notEqual(updated.artifact.contentHash, h1);
  // hashFile on disk matches
  const onDisk = await hashFile(join(taskDir, r.artifact.path));
  assert.equal(onDisk, updated.artifact.contentHash);
  await rm(base, { recursive: true, force: true });
});

test("setArtifactStatus validates transitions and records receipts", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "status-test",
    title: "Status",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "status-test");
  const r = await createArtifact(taskDir, m, {
    type: "research",
    description: "x",
    content: "",
  });
  assert.equal(r.artifact.status, "draft");
  // invalid: draft -> approved directly is blocked
  await assert.rejects(setArtifactStatus(m, "research", "approved"), /Invalid status transition/);
  await setArtifactStatus(m, "research", "in-review", taskDir);
  await setArtifactStatus(m, "research", "approved", taskDir);
  // now-approved artifact supersedable
  await setArtifactStatus(m, "research", "superseded", taskDir);
  const approvals = m.receipts.filter((r) => r.kind === "approval");
  assert.ok(approvals.length >= 1);
  await rm(base, { recursive: true, force: true });
});

test("resolvePrecedence returns chain per flow, excluding research-questions", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "prec-test",
    title: "Prec",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "prec-test");
  // add research-questions (excluded), research, design-discussion
  await createArtifact(taskDir, m, {
    type: "research-questions",
    description: "qs",
    content: "",
  });
  await createArtifact(taskDir, m, {
    type: "research",
    description: "r",
    content: "",
  });
  await createArtifact(taskDir, m, {
    type: "design-discussion",
    description: "d",
    content: "",
  });
  // rpi precedence: outline > design > research > ticket
  const inputs = resolvePrecedence(m, "structure-outline");
  const types = inputs.map((a) => a.type);
  assert.deepEqual(types, ["design-discussion", "research"]); // research-questions filtered, no outline yet
  await rm(base, { recursive: true, force: true });
});

test("changeFlow blocks when existing artifacts disabled in new flow, records receipt", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "flow-test",
    title: "Flow",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "flow-test");
  await createArtifact(taskDir, m, { type: "research", description: "x", content: "" });
  // rpi -> oneshot would orphan research
  await assert.rejects(changeFlow(m, "oneshot"), /not enabled in that flow/);
  // rpi -> freeform is fine
  await changeFlow(m, "freeform", taskDir);
  assert.equal(m.flow, "freeform");
  assert.ok(m.receipts.some((r) => r.kind === "flow-change"));
  await rm(base, { recursive: true, force: true });
});

test("malformed manifest recovers from backup and logs receipt", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "malformed",
    title: "M",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "malformed");
  // simulate a valid manifest, then corrupt the live file (backup from save is auto-created)
  await createArtifact(taskDir, m, { type: "research", description: "x", content: "ok" });
  await writeFile(join(taskDir, "artifact-manifest.json"), "{ not valid json ", "utf8");
  // should recover from backup (last good manifest) rather than crash
  const recovered = await loadManifest(taskDir);
  assert.equal(recovered.flow, "rpi");
  assert.ok(Array.isArray(recovered.artifacts));
  assert.ok(Array.isArray(recovered.receipts));
  // recovery is durable: a second open no longer crashes or re-recovers differently
  const again = await loadManifest(taskDir);
  assert.equal(again.flow, "rpi");
  // now no backup should error
  const empty = await mkdtemp(join(tmpdir(), "rpi-empty-"));
  await mkdir(join(empty, "task"));
  await writeFile(join(empty, "task", "artifact-manifest.json"), "{{", "utf8");
  await assert.rejects(() => loadManifest(join(empty, "task")), /no backup/);
  await rm(base, { recursive: true, force: true });
  await rm(empty, { recursive: true, force: true });
});

test("openTask returns migrationApplied flag for legacy manifest", async () => {
  const base = await mkTmp();
  const slug = "legacy-task";
  const taskDir = join(base, slug);
  await mkdir(taskDir, { recursive: true });
  // legacy: no flow, no receipts, no schemaVersion
  await writeFile(
    join(taskDir, "artifact-manifest.json"),
    JSON.stringify({ id: "t", slug, title: "Legacy", artifacts: [] }),
    "utf8",
  );
  const opened = await openTask(base, slug);
  assert.equal(opened.migrationApplied, true);
  assert.equal(opened.manifest.flow, "rpi");
  assert.ok(opened.manifest.receipts.some((r) => r.kind === "migration"));
  await rm(base, { recursive: true, force: true });
});

test("concurrent createArtifact calls do not lose writes (atomic manifest)", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "conc",
    title: "Concurrency",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "conc");
  await Promise.all([
    createArtifact(taskDir, m, { type: "research-questions", description: "qs", content: "qs" }),
    createArtifact(taskDir, m, { type: "research", description: "r", content: "r" }),
  ]);
  const onDisk = await loadManifest(taskDir);
  assert.equal(onDisk.artifacts.length, 2);
  const names = onDisk.artifacts.map((a) => a.path);
  assert.equal(new Set(names).size, 2);
  assert.ok(names.every((n) => /^\d{2}-/.test(n)));
  await rm(base, { recursive: true, force: true });
});

test("symlinked task root resolves through the same canonical path", async () => {
  const base = await mkTmp();
  const realRoot = await mkdtemp(join(tmpdir(), "rpi-real-"));
  const m = await createTask(base, {
    slug: "sym-task",
    title: "Symlink",
    flow: "rpi",
    baseBranch: "main",
  });
  // Move the actual task dir into realRoot, then symlink it back into place.
  const moved = join(realRoot, "sym-task");
  await rm(join(base, "sym-task"), { recursive: true, force: true });
  await mkdir(moved, { recursive: true });
  await symlink(moved, join(base, "sym-task"));
  const taskDir = join(base, "sym-task");
  const created = await createArtifact(taskDir, m, {
    type: "research",
    description: "x",
    content: "through symlink",
  });
  assert.equal(created.manifest.artifacts.length, 1);
  const onDisk = await loadManifest(taskDir);
  assert.equal(onDisk.artifacts.length, 1);
  await rm(base, { recursive: true, force: true });
  await rm(realRoot, { recursive: true, force: true });
});

test("safeRelativePath rejects absolute, traversal, and normalizes separators", () => {
  assert.equal(safeRelativePath("01-research.md"), "01-research.md");
  assert.equal(safeRelativePath("sub/02-plan.md"), "sub/02-plan.md");
  assert.equal(safeRelativePath("sub\\03-tdd.md"), "sub/03-tdd.md"); // backslash normalized
  assert.throws(() => safeRelativePath("../escape.md"), EngineError);
  assert.throws(() => safeRelativePath("/etc/passwd"), EngineError);
  assert.throws(() => safeRelativePath("a/../../b"), EngineError);
  assert.throws(() => safeRelativePath(""), EngineError);
});

test("ensureWithin rejects candidates outside the root", () => {
  const root = "/task";
  assert.equal(ensureWithin(root, "/task/01-x.md"), "/task/01-x.md");
  assert.equal(ensureWithin(root, "/task"), "/task");
  assert.throws(() => ensureWithin(root, "/other/01-x.md"), EngineError);
});
