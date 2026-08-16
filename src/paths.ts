/** Pure path helpers for the artifact protocol. No pi imports — unit-testable in plain node. */

import { relative, resolve, sep } from "node:path";

/** Default artifact root, relative to the project cwd. */
export const ARTIFACT_ROOT = ".pi/artifacts";

/** True when `candidate` is inside (or equal to) `root`. Both absolute. */
export function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

/** Resolve a tool-supplied path against the cwd, normalizing a leading "@". */
export function resolveArtifactPath(cwd: string, p: string): string {
  return resolve(cwd, p.replace(/^@/, ""));
}
