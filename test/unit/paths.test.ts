import { test } from "node:test";
import assert from "node:assert/strict";
import { ARTIFACT_ROOT, isWithinRoot, resolveArtifactPath } from "../../src/paths.ts";

test("ARTIFACT_ROOT defaults to .pi/artifacts", () => {
  assert.equal(ARTIFACT_ROOT, ".pi/artifacts");
});

test("isWithinRoot accepts the root itself and descendants", () => {
  const root = "/proj/.pi/artifacts";
  assert.equal(isWithinRoot(root, "/proj/.pi/artifacts"), true);
  assert.equal(isWithinRoot(root, "/proj/.pi/artifacts/task/x.md"), true);
  assert.equal(isWithinRoot(root, "/proj/.pi/artifacts/task/"), true);
});

test("isWithinRoot rejects siblings and prefix lookalikes", () => {
  const root = "/proj/.pi/artifacts";
  assert.equal(isWithinRoot(root, "/proj/.pi/artifactsx"), false);
  assert.equal(isWithinRoot(root, "/proj/.pi/other"), false);
  assert.equal(isWithinRoot(root, "/proj/.pi"), false);
  assert.equal(isWithinRoot(root, "/proj"), false);
});

test("isWithinRoot rejects traversal escapes", () => {
  const root = "/proj/.pi/artifacts";
  assert.equal(isWithinRoot(root, "/proj/.pi/artifacts/../escape.md"), false);
  assert.equal(isWithinRoot(root, "/proj/.pi/artifacts/../../etc/passwd"), false);
});

test("resolveArtifactPath normalizes a leading @ and resolves against cwd", () => {
  assert.equal(resolveArtifactPath("/proj", "@.pi/artifacts/x.md"), "/proj/.pi/artifacts/x.md");
  assert.equal(resolveArtifactPath("/proj", ".pi/artifacts/x.md"), "/proj/.pi/artifacts/x.md");
  assert.equal(resolveArtifactPath("/proj", "/abs/x.md"), "/abs/x.md");
});
