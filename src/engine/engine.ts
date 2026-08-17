/**
 * Artifact engine: the single testable seam for all domain rules.
 *
 * All naming, indexing, dependency/flow validation, precedence resolution,
 * status transitions, supersession, content hashing, and migrations live here.
 * Tools, commands, skills, and the TUI are thin adapters over this module.
 */

import { mkdir, readFile, rename, writeFile, copyFile, access, stat } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  type Artifact,
  type ArtifactStatus,
  type ArtifactType,
  type Flow,
  type Receipt,
  type TaskManifest,
  FLOW_CHAINS,
  FLOW_PRECEDENCE,
  isPrecedenceEligible,
  isTypeEnabled,
  SCHEMA_VERSION,
} from "./types.ts";

export interface OpenTaskResult {
  manifest: TaskManifest;
  taskDir: string;
  migrationApplied: boolean;
}

export interface CreateTaskInput {
  slug: string;
  title: string;
  flow: Flow;
  baseBranch: string;
  ticketUrl?: string;
  ticketBody?: string;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

const MANIFEST_FILENAME = "artifact-manifest.json";
const MANIFEST_BACKUP = "artifact-manifest.json.bak";

/** Serialize manifest saves so concurrent writers cannot race the atomic rename. */
let saveQueue: Promise<unknown> = Promise.resolve();
function enqueueSave<T>(fn: () => Promise<T>): Promise<T> {
  const run = saveQueue.then(fn, fn);
  saveQueue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Slug validation
// ---------------------------------------------------------------------------

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new EngineError(
      `Invalid task slug: "${slug}". Use lowercase letters, digits, and single hyphens (kebab-case).`,
    );
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function hashFile(path: string): Promise<string> {
  const content = await readFile(path, "utf8");
  return hashContent(content);
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/** Normalize a slash-separated relative path; reject empty, absolute, or traversal. */
export function safeRelativePath(p: string, label = "path"): string {
  if (!p || typeof p !== "string") throw new EngineError(`Invalid ${label}: empty`);
  // Normalize backslashes to forward slashes
  const normalized = p.replace(/\\+/g, "/");
  // Reject absolute paths and drive letters
  if (isAbsolute(normalized) || /^[a-zA-Z]:[\\/]/.test(normalized)) {
    throw new EngineError(`Invalid ${label}: absolute paths not allowed: ${p}`);
  }
  // Split and detect traversal
  const parts = normalized.split("/").filter((s) => s.length > 0);
  for (const part of parts) {
    if (part === "..") throw new EngineError(`Invalid ${label}: traversal not allowed: ${p}`);
  }
  return normalized.replace(/^\/+/, "");
}

export function ensureWithin(root: string, candidate: string): string {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !relative(root, candidate).startsWith(sep))) {
    return candidate;
  }
  throw new EngineError(`Path escapes ${root}: ${candidate}`);
}

// ---------------------------------------------------------------------------
// Index allocation
// ---------------------------------------------------------------------------

/** Next chronological NN index for a new document, accounting for existing NN- prefixed files. */
export function nextIndex(existingPaths: string[]): number {
  let max = 0;
  for (const p of existingPaths) {
    const base = p.split("/").pop() ?? p;
    const m = /^(\d{2})-/.exec(base);
    if (m) {
      const n = parseInt(m[1] ?? "0", 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Manifest filesystem I/O
// ---------------------------------------------------------------------------

export function manifestPath(taskDir: string): string {
  return join(taskDir, MANIFEST_FILENAME);
}

export async function taskDirFor(baseDir: string, slug: string): Promise<string> {
  validateSlug(slug);
  return resolve(baseDir, slug);
}

export async function loadManifest(taskDir: string): Promise<TaskManifest> {
  const path = manifestPath(taskDir);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return migrateManifest(parsed, taskDir);
  } catch (err) {
    // Recover from backup if the live file is corrupt and a backup exists
    const backup = backupPath(taskDir);
    try {
      await access(backup);
    } catch {
      throw new EngineError(`Malformed manifest at ${path} and no backup to recover from. ${String(err)}`);
    }
    // Rewrite the live file from backup so future opens succeed
    const raw = await readFile(backup, "utf8");
    const parsed = JSON.parse(raw);
    await writeFile(path, raw, "utf8");
    return migrateManifest(parsed, taskDir);
  }
}

export async function saveManifest(taskDir: string, manifest: TaskManifest): Promise<void> {
  await enqueueSave(async () => {
    const dir = dirname(taskDir);
    await mkdir(dir, { recursive: true });
    const path = manifestPath(taskDir);
    // Atomic write: write a temp file then rename (and back up current first)
    const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
    // Back up the existing manifest if present
    try {
      await access(path);
      await copyFile(path, backupPath(taskDir));
    } catch {
      // no previous manifest; nothing to back up
    }
    await rename(tmp, path);
  });
}

function backupPath(taskDir: string): string {
  return join(taskDir, MANIFEST_BACKUP);
}

// ---------------------------------------------------------------------------
// Manifest creation
// ---------------------------------------------------------------------------

export function newManifest(input: {
  slug: string;
  title: string;
  flow: Flow;
  baseBranch: string;
  ticketUrl?: string;
}): TaskManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `task-${input.slug}`,
    slug: input.slug,
    title: input.title,
    ticketUrl: input.ticketUrl,
    flow: input.flow,
    baseBranch: input.baseBranch,
    artifacts: [],
    receipts: [],
  };
}

/**
 * Create a task on disk: directory + manifest (and optional ticket.md), atomically.
 * Idempotent: creating a task that already exists returns the existing one.
 */
export async function createTask(baseDir: string, input: CreateTaskInput): Promise<TaskManifest> {
  validateSlug(input.slug);
  const taskDir = resolve(baseDir, input.slug);
  const existing = await tryLoadManifest(taskDir);
  if (existing) return existing; // idempotent reopen

  await mkdir(taskDir, { recursive: true });
  const manifest = newManifest({
    slug: input.slug,
    title: input.title,
    flow: input.flow,
    baseBranch: input.baseBranch,
    ticketUrl: input.ticketUrl,
  });
  // Ticket artifact
  if (input.ticketBody !== undefined) {
    const ticketPath = "00-ticket.md";
    const content = input.ticketBody;
    await writeFile(join(taskDir, ticketPath), content, "utf8");
    manifest.artifacts.push({
      id: "ticket",
      type: "ticket",
      path: ticketPath,
      status: "approved", // ticket is fixed input
      dependsOn: [],
      contentHash: hashContent(content),
      updatedAt: new Date().toISOString(),
    });
  }
  await saveManifest(taskDir, manifest);
  return manifest;
}

/** Open a task; returns undefined (not error) if it does not exist. */
export async function tryLoadManifest(taskDir: string): Promise<TaskManifest | null> {
  try {
    await access(manifestPath(taskDir));
  } catch {
    return null;
  }
  return loadManifest(taskDir);
}

/** Open a task with migration metadata. */
export async function openTask(baseDir: string, slug: string): Promise<OpenTaskResult> {
  validateSlug(slug);
  const taskDir = await taskDirFor(baseDir, slug);
  const manifest = await loadManifest(taskDir);
  return { manifest, taskDir, migrationApplied: wasMigrationApplied(manifest) };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

function wasMigrationApplied(manifest: TaskManifest): boolean {
  return manifest.receipts.some((r) => r.kind === "migration");
}

/**
 * Migrate a legacy manifest that lacks `flow`/`receipts[]`.
 * Defaults flow to `rpi` and records a migration receipt.
 */
export function migrateManifest(parsed: unknown, taskDir: string): TaskManifest {
  const raw = parsed as Partial<TaskManifest>;
  if (!raw || typeof raw !== "object") {
    throw new EngineError(`Malformed manifest at ${manifestPath(taskDir)}: not an object`);
  }
  if (raw.schemaVersion === SCHEMA_VERSION) {
    if (raw.flow && raw.receipts && Array.isArray(raw.artifacts)) {
      return raw as TaskManifest;
    }
  }
  // Legacy / incomplete v1: seed with rpi flow and empty receipts
  const manifest = newManifest({
    slug: raw.slug ?? "unknown",
    title: raw.title ?? raw.slug ?? "untitled task",
    flow: raw.flow ?? "rpi",
    baseBranch: raw.baseBranch ?? "main",
    ticketUrl: raw.ticketUrl,
  });
  if (Array.isArray(raw.artifacts)) {
    manifest.artifacts = raw.artifacts as Artifact[];
  }
  manifest.receipts = [
    {
      kind: "migration",
      detail: `Schema normalized to v1; flow=${manifest.flow}, receipts initialized.`,
      timestamp: new Date().toISOString(),
    },
  ];
  return manifest;
}

// ---------------------------------------------------------------------------
// Artifact operations
// ---------------------------------------------------------------------------

export interface CreateArtifactInput {
  type: ArtifactType;
  description: string; // 2-4 word kebab slug for the filename, e.g. "parent-child-tracking"
  dependsOn?: string[];
  content: string;
  supersedes?: string;
  status?: ArtifactStatus;
}

export interface CreateArtifactResult {
  manifest: TaskManifest;
  artifact: Artifact;
  path: string;
}

/** Create an artifact (optionally persisting its file) inside a task. */
export async function createArtifact(
  taskDir: string,
  manifest: TaskManifest,
  input: CreateArtifactInput,
): Promise<CreateArtifactResult> {
  // Flow validation
  if (!isTypeEnabled(manifest.flow, input.type)) {
    throw new EngineError(
      `Artifact type "${input.type}" is not enabled in flow "${manifest.flow}". Change the task flow to enable it.`,
    );
  }

  // Dependency validation
  for (const dep of input.dependsOn ?? []) {
    const existing = manifest.artifacts.find((a) => a.id === dep);
    if (!existing) {
      throw new EngineError(`Dependency "${dep}" does not exist in this task.`);
    }
    if (!isPrecedenceEligible(existing.type) && existing.type !== "ticket") {
      // research-questions dependency is allowed to produce research; handled below
    }
    if (existing.status === "draft" || existing.status === "in-review") {
      // Allowed to depend on draft/in-review; plan/outline/implement may require approved.
      // We do not hard-block here; the calling skill decides via precedence.
    }
  }

  // Precedence: the new artifact's own type must be rendered from upstream, but we validate
  // only that dependsOn entries are valid and stable. The precedence chain is
  // resolved via resolvePrecedence() for reads.

  // Index allocation & name
  const existingPaths = manifest.artifacts
    .filter((a) => a.path !== "ticket" && a.path !== "00-ticket.md")
    .map((a) => a.path);
  const idx = nextIndex(existingPaths);
  const filename = `${String(idx).padStart(2, "0")}-${input.description}.md`;
  const fullPath = join(taskDir, filename);
  ensureWithin(taskDir, fullPath);

  const now = new Date().toISOString();
  const contentHash = hashContent(input.content);
  const artifact: Artifact = {
    id: input.type,
    type: input.type,
    path: filename,
    status: input.status ?? "draft",
    dependsOn: input.dependsOn ?? [],
    supersedes: input.supersedes,
    contentHash,
    updatedAt: now,
  };

  // Persist file
  await writeFile(fullPath, input.content, "utf8");
  manifest.artifacts.push(artifact);

  // Supersede the replaced artifact
  if (input.supersedes) {
    const replaced = manifest.artifacts.find((a) => a.id === input.supersedes);
    if (replaced) {
      replaced.status = "superseded";
      manifest.receipts.push({
        kind: "status-change",
        artifactId: replaced.id,
        detail: `superseded by ${artifact.id}`,
        timestamp: now,
      });
    }
  }

  await saveManifest(taskDir, manifest);
  return { manifest, artifact, path: fullPath };
}

/** Update an artifact's file and contentHash in place. Returns updated manifest + artifact. */
export async function updateArtifact(
  taskDir: string,
  manifest: TaskManifest,
  artifactId: string,
  content: string,
): Promise<{ manifest: TaskManifest; artifact: Artifact }> {
  const artifact = manifest.artifacts.find((a) => a.id === artifactId);
  if (!artifact) throw new EngineError(`Artifact "${artifactId}" not found.`);

  artifact.contentHash = hashContent(content);
  artifact.updatedAt = new Date().toISOString();
  await writeFile(join(taskDir, artifact.path), content, "utf8");
  await saveManifest(taskDir, manifest);
  return { manifest, artifact };
}

/** Set an artifact's status with transition validation. */
export async function setArtifactStatus(
  manifest: TaskManifest,
  artifactId: string,
  status: ArtifactStatus,
  taskDir?: string,
): Promise<TaskManifest> {
  const artifact = manifest.artifacts.find((a) => a.id === artifactId);
  if (!artifact) throw new EngineError(`Artifact "${artifactId}" not found.`);

  const from = artifact.status;
  assertStatusTransition(from, status, artifactId);
  artifact.status = status;
  manifest.receipts.push({
    kind: status === "approved" ? "approval" : "status-change",
    artifactId,
    timestamp: new Date().toISOString(),
  });
  if (taskDir) await saveManifest(taskDir, manifest);
  return manifest;
}

export function assertStatusTransition(from: ArtifactStatus, to: ArtifactStatus, artifactId: string): void {
  if (from === to) return;
  const valid: Record<ArtifactStatus, ArtifactStatus[]> = {
    draft: ["in-review"],
    "in-review": ["approved", "draft"],
    approved: ["superseded"],
    superseded: [],
  };
  if (!valid[from].includes(to)) {
    throw new EngineError(`Invalid status transition ${from} -> ${to} for "${artifactId}".`);
  }
}

// ---------------------------------------------------------------------------
// Precedence resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which artifacts are authoritative inputs for a given "from" type,
 * using the task flow's precedence chain. Only artifacts present in the task
 * participate; absent chain members simply do not count.
 */
export function resolvePrecedence(manifest: TaskManifest, fromType: ArtifactType): Artifact[] {
  const chain = FLOW_PRECEDENCE[manifest.flow];
  const eligible = chain.filter((t) => isPrecedenceEligible(t));
  const result: Artifact[] = [];
  for (const type of eligible) {
    const a = manifest.artifacts.find((x) => x.type === type);
    if (a && a.status !== "superseded") result.push(a);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Flow transitions
// ---------------------------------------------------------------------------

export async function changeFlow(manifest: TaskManifest, flow: Flow, taskDir?: string): Promise<TaskManifest> {
  // Block flows that would orphan already-created artifacts of now-disabled types
  const nowDisabled = manifest.artifacts.filter((a) => !isTypeEnabled(flow, a.type));
  if (nowDisabled.length > 0) {
    throw new EngineError(
      `Cannot change flow to "${flow}": existing artifacts are not enabled in that flow: ${nowDisabled
        .map((a) => a.id)
        .join(", ")}. Supersede or delete them first.`,
    );
  }
  const old = manifest.flow;
  manifest.flow = flow;
  manifest.receipts.push({
    kind: "flow-change",
    detail: `${old} -> ${flow}`,
    timestamp: new Date().toISOString(),
  });
  if (taskDir) await saveManifest(taskDir, manifest);
  return manifest;
}

/** Validate a concrete path stays within the task dir (defense in depth). */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
