import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, rename, unlink } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
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
  readArtifact,
  recordPhaseCommit,
  setArtifactStatus,
  setBaseBranch,
  updateArtifact,
  validateSlug,
  hashFile,
  safeRelativePath,
  ensureWithin,
} from "../../src/engine/engine.ts";
import { isTypeEnabled } from "../../src/engine/types.ts";

const execFile = promisify(execFileCallback);

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
  assert.equal(m.artifacts[0]?.path, "ticket.md");
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

  const r1 = await createArtifact(taskDir, {
    type: "research-questions",
    description: "current-state",
    content: "# Questions\n",
    dependsOn: [],
  });
  assert.equal(r1.artifact.path, "01-research-questions-current-state.md");
  await setArtifactStatus(r1.manifest, "research-questions", "in-review", taskDir);
  await setArtifactStatus(r1.manifest, "research-questions", "approved", taskDir);

  const r2 = await createArtifact(taskDir, {
    type: "research",
    description: "auth-current",
    content: "# Research\n",
    dependsOn: ["research-questions"],
  });
  assert.equal(r2.artifact.path, "02-research-auth-current.md");

  // prd not enabled in rpi flow
  await assert.rejects(
    createArtifact(taskDir, { type: "prd", description: "unused", content: "", dependsOn: [] }),
    /not enabled in flow/,
  );
  await rm(base, { recursive: true, force: true });
});

test("createArtifact normalizes human descriptions and rejects unsafe filename input", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "description-input", title: "Description", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "description-input");
  const created = await createArtifact(taskDir, {
    type: "research",
    description: "Ship New__Artifact Feature",
    content: "",
    dependsOn: [],
  });
  assert.equal(created.artifact.path, "01-research-ship-new-artifact-feature.md");
  for (const description of ["unsafe/name", "unsafe\\name", "unsafe.name", "---"]) {
    await assert.rejects(
      createArtifact(taskDir, { type: "research", description, content: "", dependsOn: [] }),
      /Invalid description/,
    );
  }
  await rm(base, { recursive: true, force: true });
});

test("createArtifact requires approved dependencies", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "dependency-status", title: "Dependencies", flow: "rpi", baseBranch: "main" });
  const taskDir = join(base, "dependency-status");
  const questions = await createArtifact(taskDir, {
    type: "research-questions",
    description: "Questions",
    content: "",
    dependsOn: [],
  });
  await assert.rejects(
    createArtifact(taskDir, {
      type: "research",
      description: "Research",
      content: "",
      dependsOn: ["research-questions"],
    }),
    /Dependency "research-questions" has status "draft"/,
  );
  await setArtifactStatus(questions.manifest, "research-questions", "in-review", taskDir);
  await assert.rejects(
    createArtifact(taskDir, {
      type: "research",
      description: "Research",
      content: "",
      dependsOn: ["research-questions"],
    }),
    /Dependency "research-questions" has status "in-review"/,
  );
  await setArtifactStatus(questions.manifest, "research-questions", "approved", taskDir);
  const research = await createArtifact(taskDir, {
    type: "research",
    description: "Research",
    content: "",
    dependsOn: ["research-questions"],
  });
  assert.equal(research.artifact.path, "02-research-research.md");
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
    createArtifact(taskDir, {
      type: "research",
      description: "no-predecessor",
      content: "",
      dependsOn: [],
    }),
    /requires active predecessor "research-questions"/,
  );
  const questions = await createArtifact(taskDir, {
    type: "research-questions",
    description: "qs",
    content: "",
    dependsOn: [],
  });
  await setArtifactStatus(questions.manifest, "research-questions", "in-review", taskDir);
  await setArtifactStatus(questions.manifest, "research-questions", "approved", taskDir);
  await assert.rejects(
    createArtifact(taskDir, {
      type: "research",
      description: "omitted",
      content: "",
    } as unknown as Parameters<typeof createArtifact>[1]),
    /dependsOn must be provided/,
  );
  await assert.rejects(
    createArtifact(taskDir, {
      type: "research",
      description: "wrong",
      content: "",
      dependsOn: ["does-not-exist"],
    }),
    /requires dependsOn: \[research-questions\]/,
  );
  await assert.rejects(
    createArtifact(taskDir, {
      type: "research",
      description: "missing",
      content: "",
      dependsOn: [],
    }),
    /requires dependsOn: \[research-questions\]/,
  );
  assert.equal(questions.artifact.id, "research-questions");
  await rm(base, { recursive: true, force: true });
});

test("updateArtifact updates content hash", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "hash-test",
    title: "Hash",
    flow: "freeform",
    baseBranch: "main",
  });
  const taskDir = join(base, "hash-test");
  const r = await createArtifact(taskDir, {
    type: "research",
    description: "x",
    content: "v1",
    dependsOn: [],
  });
  const h1 = r.artifact.contentHash;
  const updated = await updateArtifact(taskDir, "research", "v2 longer");
  assert.notEqual(updated.artifact.contentHash, h1);
  // hashFile on disk matches
  const onDisk = await hashFile(join(taskDir, r.artifact.path));
  assert.equal(onDisk, updated.artifact.contentHash);
  await rm(base, { recursive: true, force: true });
});

test("substantive artifact updates invalidate approved and in-review transitive dependents while preserving history", async () => {
  const base = await mkTmp();
  await createTask(base, {
    slug: "approval-integrity",
    title: "Approval integrity",
    flow: "freeform",
    baseBranch: "main",
  });
  const taskDir = join(base, "approval-integrity");
  await createArtifact(taskDir, { type: "research", description: "source", content: "original", dependsOn: [] });
  await setArtifactStatus(await loadManifest(taskDir), "research", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "research", "approved", taskDir);
  await createArtifact(taskDir, { type: "plan", description: "dependent", content: "plan", dependsOn: ["research"] });
  await setArtifactStatus(await loadManifest(taskDir), "plan", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "plan", "approved", taskDir);
  await createArtifact(taskDir, {
    type: "implementation",
    description: "transitive",
    content: "implementation",
    dependsOn: ["plan"],
  });
  await setArtifactStatus(await loadManifest(taskDir), "implementation", "in-review", taskDir);
  await recordPhaseCommit(taskDir, "Phase 9: Historical", "run-old", "c".repeat(40));
  const receiptsBefore = (await loadManifest(taskDir)).receipts.length;
  const result = await updateArtifact(taskDir, "research", "changed");
  assert.deepEqual(result.invalidatedArtifactIds, ["research", "plan", "implementation"]);
  assert.deepEqual(
    result.manifest.artifacts.map((artifact) => artifact.status),
    ["draft", "draft", "draft"],
  );
  assert.ok(result.manifest.receipts.length > receiptsBefore);
  assert.equal(result.manifest.receipts.filter((receipt) => receipt.kind === "approval").length, 2);
  assert.equal(result.manifest.receipts.filter((receipt) => receipt.kind === "phase-commit").length, 1);
  await rm(base, { recursive: true, force: true });
});

test("substantive updates do not invalidate through superseded history", async () => {
  const base = await mkTmp();
  await createTask(base, {
    slug: "superseded-integrity",
    title: "Superseded integrity",
    flow: "freeform",
    baseBranch: "main",
  });
  const taskDir = join(base, "superseded-integrity");
  await createArtifact(taskDir, { type: "research", description: "source", content: "source", dependsOn: [] });
  await setArtifactStatus(await loadManifest(taskDir), "research", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "research", "approved", taskDir);
  await createArtifact(taskDir, { type: "plan", description: "old", content: "old", dependsOn: ["research"] });
  await setArtifactStatus(await loadManifest(taskDir), "plan", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "plan", "approved", taskDir);
  await createArtifact(taskDir, {
    type: "implementation",
    description: "dependent",
    content: "dependent",
    dependsOn: ["plan"],
  });
  await setArtifactStatus(await loadManifest(taskDir), "implementation", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "implementation", "approved", taskDir);
  await createArtifact(taskDir, {
    type: "plan",
    description: "replacement",
    content: "replacement",
    dependsOn: ["research"],
    supersedes: "plan",
  });

  const result = await updateArtifact(taskDir, "research", "changed");
  assert.deepEqual(result.invalidatedArtifactIds, ["research"]);
  assert.equal(result.manifest.artifacts.find((artifact) => artifact.id === "plan")?.status, "superseded");
  assert.equal(result.manifest.artifacts.find((artifact) => artifact.id === "implementation")?.status, "approved");
  await rm(base, { recursive: true, force: true });
});

test("only exact receipt-backed phase heading markers preserve approval", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "phase-markers", title: "Phase markers", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "phase-markers");
  const original = "# Plan\n\n## Phase 1: Build it\n\n- [ ] verify\n";
  await createArtifact(taskDir, { type: "plan", description: "phases", content: original, dependsOn: [] });
  await setArtifactStatus(await loadManifest(taskDir), "plan", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "plan", "approved", taskDir);
  await recordPhaseCommit(taskDir, "Phase 1: Build it", "run-1", "a".repeat(40));
  const marked = original.replace("## Phase 1: Build it", "## ✅ Phase 1: Build it");
  const verified = await updateArtifact(taskDir, "plan", marked);
  assert.equal(verified.artifact.status, "approved");
  assert.deepEqual(verified.invalidatedArtifactIds, []);
  const checkboxChange = await updateArtifact(taskDir, "plan", marked.replace("- [ ]", "- [x]"));
  assert.equal(checkboxChange.artifact.status, "draft");
  await setArtifactStatus(await loadManifest(taskDir), "plan", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "plan", "approved", taskDir);
  const removal = await updateArtifact(taskDir, "plan", original.replace("- [ ]", "- [x]"));
  assert.equal(removal.artifact.status, "draft");
  await setArtifactStatus(await loadManifest(taskDir), "plan", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "plan", "approved", taskDir);
  await updateArtifact(taskDir, "plan", "## Phase 2: No receipt\n");
  await setArtifactStatus(await loadManifest(taskDir), "plan", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "plan", "approved", taskDir);
  const missingReceipt = await updateArtifact(taskDir, "plan", "## ✅ Phase 2: No receipt\n");
  assert.equal(missingReceipt.artifact.status, "draft");
  await updateArtifact(taskDir, "plan", "## Phase 1: Duplicate\n\n## Phase 1: Duplicate\n");
  await setArtifactStatus(await loadManifest(taskDir), "plan", "in-review", taskDir);
  await setArtifactStatus(await loadManifest(taskDir), "plan", "approved", taskDir);
  await recordPhaseCommit(taskDir, "Phase 1: Duplicate", "run-duplicate", "d".repeat(40));
  const duplicate = await updateArtifact(taskDir, "plan", "## ✅ Phase 1: Duplicate\n\n## ✅ Phase 1: Duplicate\n");
  assert.equal(duplicate.artifact.status, "draft");
  await rm(base, { recursive: true, force: true });
});

test("setArtifactStatus validates transitions and records receipts", async () => {
  const base = await mkTmp();
  await createTask(base, {
    slug: "status-test",
    title: "Status",
    flow: "freeform",
    baseBranch: "main",
  });
  const taskDir = join(base, "status-test");
  const r = await createArtifact(taskDir, {
    type: "research",
    description: "x",
    content: "",
    dependsOn: [],
  });
  assert.equal(r.artifact.status, "draft");
  // createArtifact loads fresh from disk; reload for status operations.
  const m = await loadManifest(taskDir);
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
  await createTask(base, {
    slug: "prec-test",
    title: "Prec",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "prec-test");
  // add research-questions (excluded), research, design-discussion
  await createArtifact(taskDir, {
    type: "research-questions",
    description: "qs",
    content: "",
    dependsOn: [],
  });
  let manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, "research-questions", "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, "research-questions", "approved", taskDir);
  await createArtifact(taskDir, {
    type: "research",
    description: "r",
    content: "",
    dependsOn: ["research-questions"],
  });
  manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, "research", "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, "research", "approved", taskDir);
  await createArtifact(taskDir, {
    type: "design-discussion",
    description: "d",
    content: "",
    dependsOn: ["research"],
  });
  // createArtifact loads fresh from disk; reload before precedence resolution.
  const m = await loadManifest(taskDir);
  // rpi precedence for outline inputs: design > research (ticket absent here)
  const inputs = resolvePrecedence(m, "structure-outline");
  const types = inputs.map((a) => a.type);
  assert.deepEqual(types, ["design-discussion", "research"]); // research-questions filtered
  await rm(base, { recursive: true, force: true });
});

test("changeFlow blocks when existing artifacts disabled in new flow, records receipt", async () => {
  const base = await mkTmp();
  await createTask(base, {
    slug: "flow-test",
    title: "Flow",
    flow: "rpi",
    baseBranch: "main",
  });
  const taskDir = join(base, "flow-test");
  await createArtifact(taskDir, { type: "research-questions", description: "qs", content: "", dependsOn: [] });
  let manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, "research-questions", "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, "research-questions", "approved", taskDir);
  await createArtifact(taskDir, { type: "research", description: "x", content: "", dependsOn: ["research-questions"] });
  const m = await loadManifest(taskDir);
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
    flow: "freeform",
    baseBranch: "main",
  });
  const taskDir = join(base, "malformed");
  // simulate a valid manifest, then corrupt the live file (backup from save is auto-created)
  await createArtifact(taskDir, { type: "research", description: "x", content: "ok", dependsOn: [] });
  await writeFile(join(taskDir, "artifact-manifest.json"), "{ not valid json ", "utf8");
  // should recover from backup (last good manifest) rather than crash
  const recovered = await loadManifest(taskDir);
  assert.equal(recovered.flow, "freeform");
  assert.ok(Array.isArray(recovered.artifacts));
  assert.ok(Array.isArray(recovered.receipts));
  // recovery is durable: a second open no longer crashes or re-recovers differently
  const again = await loadManifest(taskDir);
  assert.equal(again.flow, "freeform");
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
    flow: "freeform",
    baseBranch: "main",
  });
  const taskDir = join(base, "conc");
  await Promise.all([
    createArtifact(taskDir, { type: "research-questions", description: "qs", content: "qs", dependsOn: [] }),
    createArtifact(taskDir, { type: "research", description: "r", content: "r", dependsOn: [] }),
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
    flow: "freeform",
    baseBranch: "main",
  });
  // Move the actual task dir into realRoot, then symlink it back into place.
  const moved = join(realRoot, "sym-task");
  await rename(join(base, "sym-task"), moved);
  await symlink(moved, join(base, "sym-task"));
  const taskDir = join(base, "sym-task");
  const created = await createArtifact(taskDir, {
    type: "research",
    description: "x",
    content: "through symlink",
    dependsOn: [],
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

test("loadManifest rejects malformed schema-v1 fields without silently accepting them", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "strict-manifest", title: "Strict", flow: "rpi", baseBranch: "main" });
  const taskDir = join(base, "strict-manifest");
  const manifest = await loadManifest(taskDir);
  const artifact = {
    id: "research",
    type: "research",
    path: "01-research.md",
    status: "draft",
    dependsOn: [],
    contentHash: "a".repeat(64),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const invalidCases: Array<{ value: unknown; error: RegExp }> = [
    { value: { ...manifest, unexpected: true }, error: /unexpected/ },
    { value: { ...manifest, flow: "unknown" }, error: /manifest.flow/ },
    { value: { ...manifest, artifacts: [{ ...artifact, id: "wrong-id" }] }, error: /artifacts\[0\]\.id/ },
    { value: { ...manifest, artifacts: [{ ...artifact, path: "../outside.md" }] }, error: /artifacts\[0\]\.path/ },
    { value: { ...manifest, artifacts: [{ ...artifact, contentHash: "not-a-sha256" }] }, error: /contentHash/ },
    { value: { ...manifest, artifacts: [{ ...artifact, updatedAt: "not-a-timestamp" }] }, error: /updatedAt/ },
    { value: { ...manifest, artifacts: [{ ...artifact, dependsOn: ["missing"] }] }, error: /unknown dependency/ },
    {
      value: { ...manifest, artifacts: [artifact, { ...artifact, id: "research-v2", path: "02-research.md" }] },
      error: /duplicate active artifact type/,
    },
    {
      value: { ...manifest, receipts: [{ kind: "unknown", timestamp: "2026-01-01T00:00:00.000Z" }] },
      error: /receipt.*kind/,
    },
    {
      value: { ...manifest, receipts: [{ kind: "drift", timestamp: "2026-01-01T00:00:00.000Z", extra: true }] },
      error: /extra/,
    },
  ];
  for (const invalid of invalidCases) {
    await writeFile(join(taskDir, "artifact-manifest.json"), JSON.stringify(invalid.value), "utf8");
    await assert.rejects(loadManifest(taskDir), invalid.error);
  }
  await rm(base, { recursive: true, force: true });
});

test("updateArtifact and openTask reject artifact symlinks outside a canonical task root", async () => {
  const base = await mkTmp();
  const realRoot = await mkdtemp(join(tmpdir(), "rpi-real-root-"));
  await createTask(base, { slug: "safe-links", title: "Links", flow: "freeform", baseBranch: "main" });
  const originalTaskDir = join(base, "safe-links");
  const created = await createArtifact(originalTaskDir, {
    type: "research",
    description: "r",
    content: "inside",
    dependsOn: [],
  });
  const outside = join(base, "outside.md");
  await writeFile(outside, "outside");
  await unlink(join(originalTaskDir, created.artifact.path));
  await symlink(outside, join(originalTaskDir, created.artifact.path));
  await assert.rejects(readArtifact(originalTaskDir, "research"), /Unsafe artifact path/);
  await assert.rejects(updateArtifact(originalTaskDir, "research", "overwrite"), /Unsafe artifact path/);
  await assert.rejects(openTask(base, "safe-links"), /Unsafe artifact path/);

  const movedTaskDir = join(realRoot, "safe-links");
  await rename(originalTaskDir, movedTaskDir);
  await symlink(movedTaskDir, originalTaskDir);
  await assert.rejects(updateArtifact(originalTaskDir, "research", "overwrite"), /Unsafe artifact path/);
  await rm(base, { recursive: true, force: true });
  await rm(realRoot, { recursive: true, force: true });
});

test("engine task directory lookup rejects traversal slugs", async () => {
  const base = await mkTmp();
  await assert.rejects(openTask(base, "../outside"), /Invalid task slug/);
  await rm(base, { recursive: true, force: true });
});

test("createArtifact refuses to overwrite an unmanaged filesystem collision", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "collision", title: "Collision", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "collision");
  const unmanagedPath = join(taskDir, "01-research-research.md");
  await writeFile(unmanagedPath, "keep this", "utf8");
  await assert.rejects(
    createArtifact(taskDir, { type: "research", description: "research", content: "replace", dependsOn: [] }),
    /unmanaged artifact file collision/,
  );
  assert.equal(await readFile(unmanagedPath, "utf8"), "keep this");
  await rm(base, { recursive: true, force: true });
});

test("manifest parsing accepts artifact version v10", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "version-ten", title: "Version", flow: "rpi", baseBranch: "main" });
  const taskDir = join(base, "version-ten");
  const manifest = await loadManifest(taskDir);
  manifest.artifacts.push({
    id: "research-v10",
    type: "research",
    path: "10-research.md",
    status: "draft",
    dependsOn: [],
    contentHash: "a".repeat(64),
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await writeFile(join(taskDir, "artifact-manifest.json"), JSON.stringify(manifest), "utf8");
  assert.equal((await loadManifest(taskDir)).artifacts[0]?.id, "research-v10");
  await rm(base, { recursive: true, force: true });
});

test("real task paths and symlink aliases share one in-process lock", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "alias-lock", title: "Alias", flow: "freeform", baseBranch: "main" });
  const realTaskDir = join(base, "alias-lock");
  const aliasTaskDir = join(base, "alias");
  await symlink(realTaskDir, aliasTaskDir);
  await Promise.all([
    createArtifact(realTaskDir, { type: "research-questions", description: "questions", content: "q", dependsOn: [] }),
    createArtifact(aliasTaskDir, { type: "research", description: "research", content: "r", dependsOn: [] }),
  ]);
  assert.equal((await loadManifest(realTaskDir)).artifacts.length, 2);
  await rm(base, { recursive: true, force: true });
});

test("cross-process artifact creates preserve both manifest updates and recover a dead lock", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "process-lock", title: "Process", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "process-lock");
  await writeFile(
    join(taskDir, ".artifact-manifest.lock"),
    JSON.stringify({ owner: "dead", pid: 999_999_999, createdAt: 0 }),
    "utf8",
  );
  const engineUrl = pathToFileURL(join(process.cwd(), "src/engine/engine.ts")).href;
  const child = (type: string, description: string) =>
    execFile(process.execPath, [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      `const { createArtifact } = await import(${JSON.stringify(engineUrl)}); await createArtifact(${JSON.stringify(taskDir)}, { type: ${JSON.stringify(type)}, description: ${JSON.stringify(description)}, content: "child", dependsOn: [] });`,
    ]);
  await Promise.all([child("research-questions", "questions"), child("research", "research")]);
  assert.equal((await loadManifest(taskDir)).artifacts.length, 2);
  await rm(base, { recursive: true, force: true });
});

test("setBaseBranch persists the selected ref, records a receipt, and preserves fresh task state", async () => {
  const base = await mkTmp();
  const manifest = await createTask(base, {
    slug: "base-branch",
    title: "Base branch",
    flow: "freeform",
    baseBranch: "main",
  });
  const taskDir = join(base, manifest.slug);
  const staleManifest = await loadManifest(taskDir);
  await createArtifact(taskDir, { type: "mockup", description: "mockup", content: "m", dependsOn: [] });

  const updated = await setBaseBranch(staleManifest, "origin/release", taskDir);
  const onDisk = await loadManifest(taskDir);

  assert.equal(updated.baseBranch, "origin/release");
  assert.equal(onDisk.baseBranch, "origin/release");
  assert.equal(onDisk.artifacts.length, 1);
  assert.equal(onDisk.artifacts[0]?.id, "mockup");
  assert.ok(
    onDisk.receipts.some(
      (receipt) => receipt.kind === "base-branch-change" && receipt.detail === "main -> origin/release",
    ),
  );
  await assert.rejects(setBaseBranch(updated, "", taskDir), /Base branch must not be empty/);
  await rm(base, { recursive: true, force: true });
});

test("persisted status and flow changes reload state instead of saving stale caller manifests", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "fresh-state", title: "Fresh", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "fresh-state");
  await createArtifact(taskDir, { type: "research", description: "research", content: "r", dependsOn: [] });
  const staleStatusManifest = await loadManifest(taskDir);
  await createArtifact(taskDir, { type: "research-questions", description: "questions", content: "q", dependsOn: [] });
  await setArtifactStatus(staleStatusManifest, "research", "in-review", taskDir);
  const staleFlowManifest = await loadManifest(taskDir);
  await createArtifact(taskDir, { type: "mockup", description: "mockup", content: "m", dependsOn: [] });
  await changeFlow(staleFlowManifest, "freeform", taskDir);
  const onDisk = await loadManifest(taskDir);
  assert.equal(onDisk.artifacts.length, 3);
  assert.equal(onDisk.flow, "freeform");
  assert.equal(onDisk.artifacts.find((artifact) => artifact.id === "research")?.status, "in-review");
  await rm(base, { recursive: true, force: true });
});

test("supersession accepts only the active approved artifact of the same type", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "strict-supersede", title: "Supersede", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "strict-supersede");
  await createArtifact(taskDir, { type: "research", description: "research", content: "r1", dependsOn: [] });
  let manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, "research", "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, "research", "approved", taskDir);
  await createArtifact(taskDir, { type: "design-discussion", description: "design", content: "d", dependsOn: [] });
  await assert.rejects(
    createArtifact(taskDir, {
      type: "research",
      description: "wrong",
      content: "r2",
      dependsOn: [],
      supersedes: "design-discussion",
    }),
    /expected "research"/,
  );
  const replacement = await createArtifact(taskDir, {
    type: "research",
    description: "research-v2",
    content: "r2",
    dependsOn: [],
    supersedes: "research",
  });
  manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, replacement.artifact.id, "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, replacement.artifact.id, "approved", taskDir);
  const logicalReplacement = await createArtifact(taskDir, {
    type: "research",
    description: "research-v3",
    content: "r3",
    dependsOn: [],
    supersedes: "research",
  });
  assert.equal(logicalReplacement.artifact.id, "research-v3");
  assert.equal(
    (await loadManifest(taskDir)).artifacts.filter(
      (artifact) => artifact.type === "research" && artifact.status !== "superseded",
    ).length,
    1,
  );
  await rm(base, { recursive: true, force: true });
});

test("changeFlow ignores superseded history but blocks active incompatible artifacts", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "flow-history", title: "Flow", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "flow-history");
  await createArtifact(taskDir, { type: "design-discussion", description: "design", content: "d1", dependsOn: [] });
  let manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, "design-discussion", "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, "design-discussion", "approved", taskDir);
  await createArtifact(taskDir, {
    type: "design-discussion",
    description: "replacement",
    content: "d2",
    dependsOn: [],
    supersedes: "design-discussion",
  });
  await changeFlow(await loadManifest(taskDir), "rpi", taskDir);

  await assert.rejects(changeFlow(await loadManifest(taskDir), "prd", taskDir), /design-discussion-v2/);
  manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, "design-discussion-v2", "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, "design-discussion-v2", "approved", taskDir);
  await setArtifactStatus(manifest, "design-discussion-v2", "superseded", taskDir);
  assert.equal((await changeFlow(await loadManifest(taskDir), "prd", taskDir)).flow, "prd");
  await rm(base, { recursive: true, force: true });
});

test("pr-walkthrough accepts implementation input and remains supporting material across flows", async () => {
  const base = await mkTmp();
  await createTask(base, {
    slug: "flow-walkthrough",
    title: "Flow",
    flow: "oneshot",
    baseBranch: "main",
    ticketBody: "ticket",
  });
  const taskDir = join(base, "flow-walkthrough");
  let manifest = await loadManifest(taskDir);
  await createArtifact(taskDir, {
    type: "implementation",
    description: "implementation",
    content: "i",
    dependsOn: ["ticket"],
  });
  manifest = await loadManifest(taskDir);
  await setArtifactStatus(manifest, "implementation", "in-review", taskDir);
  manifest = await setArtifactStatus(manifest, "implementation", "approved", taskDir);
  await createArtifact(taskDir, {
    type: "pr-walkthrough",
    description: "walkthrough",
    content: "w",
    dependsOn: ["implementation"],
  });

  assert.equal((await changeFlow(await loadManifest(taskDir), "rpi", taskDir)).flow, "rpi");
  await rm(base, { recursive: true, force: true });
});

test("ticket and supporting artifacts do not block rpi to prd flow changes", async () => {
  const base = await mkTmp();
  await createTask(base, {
    slug: "flow-support",
    title: "Flow",
    flow: "rpi",
    baseBranch: "main",
    ticketBody: "ticket",
  });
  const taskDir = join(base, "flow-support");
  await createArtifact(taskDir, { type: "mockup", description: "mockup", content: "m", dependsOn: [] });
  await createArtifact(taskDir, { type: "diagram", description: "diagram", content: "d", dependsOn: [] });
  assert.equal((await changeFlow(await loadManifest(taskDir), "prd", taskDir)).flow, "prd");
  await rm(base, { recursive: true, force: true });
});

test("legacy migration saves once and later opens do not add migration receipts", async () => {
  const base = await mkTmp();
  const taskDir = join(base, "migrate-once");
  await mkdir(taskDir, { recursive: true });
  await writeFile(
    join(taskDir, "artifact-manifest.json"),
    JSON.stringify({ slug: "migrate-once", title: "Legacy", artifacts: [] }),
    "utf8",
  );
  const first = await openTask(base, "migrate-once");
  const firstOnDisk = await readFile(join(taskDir, "artifact-manifest.json"), "utf8");
  const second = await openTask(base, "migrate-once");
  const secondOnDisk = await readFile(join(taskDir, "artifact-manifest.json"), "utf8");
  assert.equal(first.migrationApplied, true);
  assert.equal(second.migrationApplied, false);
  assert.equal(second.manifest.receipts.filter((receipt) => receipt.kind === "migration").length, 1);
  assert.equal(secondOnDisk, firstOnDisk);
  await rm(base, { recursive: true, force: true });
});

test("a fresh lock owned by the current live process is not stolen", { timeout: 7_000 }, async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "live-lock", title: "Live lock", flow: "freeform", baseBranch: "main" });
  const taskDir = join(base, "live-lock");
  const lockPath = join(taskDir, ".artifact-manifest.lock");
  await writeFile(lockPath, JSON.stringify({ owner: "live-test", pid: process.pid, createdAt: Date.now() }), "utf8");
  try {
    await assert.rejects(
      createArtifact(taskDir, { type: "research", description: "blocked", content: "", dependsOn: [] }),
      /Timed out waiting for task lock/,
    );
  } finally {
    await unlink(lockPath).catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
});
