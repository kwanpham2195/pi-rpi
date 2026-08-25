import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changeFlow,
  createArtifact,
  createTask,
  loadManifest,
  resolvePrecedence,
  setArtifactStatus,
} from "../../src/engine/index.ts";

async function mkTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rpi-int-"));
}

test("rpi-flow lifecycle mirrors the documented UI path", async () => {
  const base = await mkTmp();
  await createTask(base, {
    slug: "eng-1478-parent-child",
    title: "Parent child tracking",
    flow: "rpi",
    baseBranch: "main",
    ticketBody: "# ENG-1478\n\nTrack parent-child.",
  });
  const taskDir = join(base, "eng-1478-parent-child");
  let m = await loadManifest(taskDir);

  // questions -> research -> design -> outline -> (plan) -> implementation -> pr
  await createArtifact(taskDir, { type: "research-questions", description: "current-state", content: "Q", dependsOn: [] });
  await createArtifact(taskDir, {
    type: "research",
    description: "parent-child",
    content: "R",
   dependsOn: ["research-questions"],
  });
  await createArtifact(taskDir, {
    type: "design-discussion",
    description: "parent-child",
    content: "D",
   dependsOn: ["research"],
  });
  const outline = await createArtifact(taskDir, {
    type: "structure-outline",
    description: "parent-child",
    content: "O",
   dependsOn: ["design-discussion"],
  });
  m = await loadManifest(taskDir);
  await setArtifactStatus(m, "structure-outline", "in-review", taskDir);
  await setArtifactStatus(m, "structure-outline", "approved", taskDir);

  // On-disk artifact filenames are chronological NN-<type>-<description>.
  const names = m.artifacts.map((a) => a.path).sort();
  assert.deepEqual(names, ["01-research-questions-current-state.md", "02-research-parent-child.md", "03-design-discussion-parent-child.md", "04-structure-outline-parent-child.md", "ticket.md"]);

  // precedence for a plugin built on outline excludes research-questions and honors the chain
  const inputs = resolvePrecedence(m, "plan");
  assert.deepEqual(
    inputs.map((a) => a.type),
    ["structure-outline", "design-discussion", "research", "ticket"], // outl > design > research > ticket, no research-questions
  );

  // prd type not enabled in rpi flow
  await assert.rejects(
    createArtifact(taskDir, { type: "prd", description: "nope", content: "", dependsOn: [] }),
    /not enabled in flow/,
  );

  // reading the persisted manifest reflects everything
  const onDisk = await loadManifest(taskDir);
  assert.equal(onDisk.artifacts.filter((a) => a.type === "structure-outline")[0]?.status, "approved");

  // plan is optional: implement directly off the approved outline via a minimal implementation
  await createArtifact(taskDir, { type: "implementation", description: "parent-child", content: "impl", dependsOn: [outline.artifact.id] });

  // flow change to freeform (no orphan) works; change to prd would orphan design-discussion
  m = await loadManifest(taskDir);
  await assert.rejects(changeFlow(m, "prd", taskDir), /not enabled in that flow/);
  await changeFlow(m, "freeform", taskDir);
  assert.equal(m.flow, "freeform");

  await rm(base, { recursive: true, force: true });
});

test("oneshot flow skips planning stages", async () => {
  const base = await mkTmp();
  const m = await createTask(base, {
    slug: "hotfix",
    title: "Hotfix",
    flow: "oneshot",
    baseBranch: "main",
    ticketBody: "# FIX\n",
  });
  const taskDir = join(base, "hotfix");
  await createArtifact(taskDir, { type: "implementation", description: "hotfix", content: "fix", dependsOn: ["ticket"] });
  // research is not enabled in oneshot
  await assert.rejects(
    createArtifact(taskDir, { type: "research", description: "r", content: "", dependsOn: [] }),
    /not enabled in flow/,
  );
  const onDisk = await loadManifest(taskDir);
  assert.deepEqual(
    onDisk.artifacts.map((a) => a.type).sort(),
    ["implementation", "ticket"],
  );
  await rm(base, { recursive: true, force: true });
});

test("ticket file lands on disk with the provided body", async () => {
  const base = await mkTmp();
  const body = "# T\n\nBody text.";
  const m = await createTask(base, {
    slug: "tick",
    title: "T",
    flow: "rpi",
    baseBranch: "main",
    ticketBody: body,
  });
  const content = await readFile(join(base, "tick", "ticket.md"), "utf8");
  assert.equal(content, body);
  await rm(base, { recursive: true, force: true });
});
