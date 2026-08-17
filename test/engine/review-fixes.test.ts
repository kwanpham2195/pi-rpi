import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EngineError,
  createArtifact,
  createTask,
  findArtifact,
  loadManifest,
  resolvePrecedence,
  setArtifactStatus,
  updateArtifact,
  validateDescription,
} from "../../src/engine/index.ts";

async function mkTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rpi-fix-"));
}

test("duplicate type creation is rejected unless superseding", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "dup", title: "D", flow: "rpi", baseBranch: "main" });
  const taskDir = join(base, "dup");
  await createArtifact(taskDir, { type: "research", description: "r", content: "v1" });
  await assert.rejects(
    createArtifact(taskDir, { type: "research", description: "r2", content: "v2" }),
    /already exists.*pass supersedes/,
  );
  await rm(base, { recursive: true, force: true });
});

test("supersede requires the replaced artifact to be approved", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "sup", title: "S", flow: "rpi", baseBranch: "main" });
  const taskDir = join(base, "sup");
  await createArtifact(taskDir, { type: "research", description: "r", content: "v1" }); // draft
  // draft -> superseded is invalid
  await assert.rejects(
    createArtifact(taskDir, { type: "research", description: "r2", content: "v2", supersedes: "research" }),
    /Invalid status transition draft -> superseded/,
  );
  // approve then supersede works; the new version gets a unique id
  let m = await loadManifest(taskDir);
  await setArtifactStatus(m, "research", "in-review", taskDir);
  await setArtifactStatus(m, "research", "approved", taskDir);
  const created = await createArtifact(taskDir, {
    type: "research",
    description: "r2",
    content: "v2",
    supersedes: "research",
  });
  assert.equal(created.artifact.id, "research-v2");
  m = await loadManifest(taskDir);
  const old = m.artifacts.find((a) => a.id === "research");
  assert.equal(old?.status, "superseded");
  // findArtifact("research") resolves to the ACTIVE version, not the superseded one
  const active = findArtifact(m, "research");
  assert.equal(active?.id, "research-v2");
  assert.equal(active?.contentHash, created.artifact.contentHash);
  await rm(base, { recursive: true, force: true });
});

test("updateArtifact rejects a manifest path that escapes the task dir", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "esc", title: "E", flow: "rpi", baseBranch: "main" });
  const taskDir = join(base, "esc");
  const created = await createArtifact(taskDir, { type: "research", description: "r", content: "v1" });
  // Tamper the manifest: point the research artifact's path outside the task dir.
  const m = await loadManifest(taskDir);
  const artifact = m.artifacts.find((a) => a.id === created.artifact.id)!;
  artifact.path = "../../../../etc/pwned.md";
  await writeFile(join(taskDir, "artifact-manifest.json"), JSON.stringify(m, null, 2), "utf8");
  await assert.rejects(updateArtifact(taskDir, "research", "pwned"), /Path escapes/);
  await rm(base, { recursive: true, force: true });
});

test("validateDescription rejects traversal, slashes, dots, and spaces", () => {
  assert.equal(validateDescription("parent-child"), "parent-child");
  assert.equal(validateDescription("a1-b2"), "a1-b2");
  assert.throws(() => validateDescription("../escape"), EngineError);
  assert.throws(() => validateDescription("a/../../b"), EngineError);
  assert.throws(() => validateDescription("with space"), EngineError);
  assert.throws(() => validateDescription("UPPER"), EngineError);
  assert.throws(() => validateDescription(""), EngineError);
});

test("resolvePrecedence slices upstream of fromType and prefers active versions", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "prec", title: "P", flow: "rpi", baseBranch: "main", ticketBody: "# T" });
  const taskDir = join(base, "prec");
  await createArtifact(taskDir, { type: "research-questions", description: "qs", content: "q" });
  await createArtifact(taskDir, { type: "research", description: "r", content: "r" });
  await createArtifact(taskDir, { type: "design-discussion", description: "d", content: "d" });
  await createArtifact(taskDir, { type: "structure-outline", description: "o", content: "o", dependsOn: ["design-discussion"] });
  const m = await loadManifest(taskDir);

  // outline inputs: design, research, ticket (research-questions excluded; plan absent)
  const outlineInputs = resolvePrecedence(m, "structure-outline").map((a) => a.type);
  assert.deepEqual(outlineInputs, ["design-discussion", "research", "ticket"]);

  // plan inputs include outline (plan is newest in the chain)
  const planInputs = resolvePrecedence(m, "plan").map((a) => a.type);
  assert.deepEqual(planInputs, ["structure-outline", "design-discussion", "research", "ticket"]);
  await rm(base, { recursive: true, force: true });
});

test("mockup and diagram are auxiliary-enabled in rpi flow; prd is not", async () => {
  const base = await mkTmp();
  await createTask(base, { slug: "aux", title: "A", flow: "rpi", baseBranch: "main" });
  const taskDir = join(base, "aux");
  await createArtifact(taskDir, { type: "research", description: "r", content: "r" });
  // mockup is allowed in rpi (auxiliary supporting artifact)
  await createArtifact(taskDir, { type: "mockup", description: "picker", content: "<html></html>" });
  // prd is not allowed in rpi
  await assert.rejects(createArtifact(taskDir, { type: "prd", description: "nope", content: "" }), /not enabled/);
  await rm(base, { recursive: true, force: true });
});
