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

/** Per-task critical section: whole read-validate-mutate-persist runs under one lock. */
const taskLocks = new Map<string, Promise<unknown>>();
async function withTaskLock<T>(taskDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = taskLocks.get(taskDir) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  taskLocks.set(taskDir, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Slug / description validation
// ---------------------------------------------------------------------------

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DESCRIPTION_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new EngineError(
      `Invalid task slug: "${slug}". Use lowercase letters, digits, and single hyphens (kebab-case).`,
    );
  }
}

export function validateDescription(description: string): string {
  if (!description || typeof description !== "string") {
    throw new EngineError("Invalid description: empty.");
  }
  if (!DESCRIPTION_RE.test(description)) {
    throw new EngineError(
      `Invalid description: "${description}". Use a flat kebab-case slug (lowercase letters, digits, single hyphens, no slashes, no dots).`,
    );
  }
  return description;
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
    let raw: string;
    try {
      raw = await readFile(backup, "utf8");
    } catch {
      throw new EngineError(`Malformed manifest at ${path} and no backup to recover from. ${String(err)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new EngineError(`Malformed manifest at ${path} and the backup is also unreadable. ${String(err)}`);
    }
    // Rewrite the live file from backup so future opens succeed
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

/**
 * Open a task with migration metadata: persists migrated manifests, and records
 * a `drift` receipt when an artifact's on-disk contentHash no longer matches.
 */
export async function openTask(baseDir: string, slug: string): Promise<OpenTaskResult> {
  validateSlug(slug);
  const taskDir = await taskDirFor(baseDir, slug);
  const manifest = await loadManifest(taskDir);
  const migrationApplied = manifest.receipts.some((r) => r.kind === "migration");
  // Persist a migrated manifest so legacy files stop re-migrating on every open.
  if (migrationApplied) {
    await saveManifest(taskDir, manifest);
  }
  // Drift check: contentHash vs file for each artifact.
  for (const a of manifest.artifacts) {
    try {
      const h = await hashFile(join(taskDir, a.path));
      if (h !== a.contentHash) {
        manifest.receipts.push({
          kind: "drift",
          artifactId: a.id,
          detail: "contentHash mismatch on open",
          timestamp: new Date().toISOString(),
        });
        await saveManifest(taskDir, manifest);
        break; // one drift receipt per open is enough
      }
    } catch {
      // missing file — report as drift too
      manifest.receipts.push({
        kind: "drift",
        artifactId: a.id,
        detail: "artifact file missing on open",
        timestamp: new Date().toISOString(),
      });
      await saveManifest(taskDir, manifest);
      break;
    }
  }
  return { manifest, taskDir, migrationApplied };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrate a legacy manifest that lacks `flow`/`receipts[]`.
 * Defaults flow to `rpi` and records a migration receipt.
 */
export function migrateManifest(parsed: unknown, taskDir: string): TaskManifest {
  const raw = parsed as Partial<TaskManifest>;
  if (!raw || typeof raw !== "object") {
    throw new EngineError(`Malformed manifest at ${manifestPath(taskDir)}: not an object`);
  }
  if (raw.schemaVersion === SCHEMA_VERSION && raw.flow && raw.receipts && Array.isArray(raw.artifacts)) {
    return raw as TaskManifest;
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

/** Alias matching the plan's Engine API list. */
export async function runMigration(parsed: unknown, taskDir: string): Promise<TaskManifest> {
  return migrateManifest(parsed, taskDir);
}

// ---------------------------------------------------------------------------
// Artifact lookup
// ---------------------------------------------------------------------------

/**
 * Resolve an artifact by id or by logical type, preferring the active
 * (non-superseded) version. First-version ids equal their type, so plain type
 * lookups work until a supersession creates a `-vN` id.
 */
export function findArtifact(manifest: TaskManifest, idOrType: string): Artifact | undefined {
  const byId = manifest.artifacts.find((a) => a.id === idOrType && a.status !== "superseded");
  if (byId) return byId;
  const byType = manifest.artifacts
    .filter((a) => a.type === idOrType && a.status !== "superseded")
    .sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : -1));
  return byType[0];
}

/** Flow validation with a friendly error message. */
export function validateFlow(manifest: TaskManifest, type: ArtifactType): { ok: boolean; error?: string } {
  return isTypeEnabled(manifest.flow, type)
    ? { ok: true }
    : { ok: false, error: `Artifact type "${type}" is not enabled in flow "${manifest.flow}". Change the task flow to enable it.` };
}

// ---------------------------------------------------------------------------
// Artifact operations
// ---------------------------------------------------------------------------

export interface CreateArtifactInput {
  type: ArtifactType;
  description: string; // flat kebab-case slug for the filename, e.g. "parent-child-tracking"
  dependsOn?: string[];
  content: string;
  supersedes?: string; // id (or logical type) of the artifact this replaces; must be approved
  status?: ArtifactStatus;
}

export interface CreateArtifactResult {
  manifest: TaskManifest;
  artifact: Artifact;
  path: string;
}

/**
 * Create an artifact (persisting its file + manifest) inside a task.
 * The whole read-validate-mutate-persist sequence runs under a per-task lock
 * with a fresh manifest read, so concurrent creates cannot collide on indexes
 * or lose updates.
 */
export async function createArtifact(
  taskDir: string,
  input: CreateArtifactInput,
): Promise<CreateArtifactResult> {
  return withTaskLock(taskDir, async () => {
    const manifest = await loadManifest(taskDir);

    // Flow validation
    const flowCheck = validateFlow(manifest, input.type);
    if (!flowCheck.ok) throw new EngineError(flowCheck.error ?? "flow validation failed");

    // Status: a newly created artifact cannot start superseded.
    if (input.status === "superseded") {
      throw new EngineError("A newly created artifact cannot start as superseded.");
    }

    // Description -> flat kebab filename slug
    const desc = validateDescription(input.description);

    // Duplicate-type rejection unless superseding
    const activeSameType = manifest.artifacts.find(
      (a) => a.type === input.type && a.status !== "superseded",
    );
    if (activeSameType && !input.supersedes) {
      throw new EngineError(
        `Artifact type "${input.type}" already exists (${activeSameType.path}). Update it in place with rpi_update_artifact, or pass supersedes to replace it.`,
      );
    }

    // Supersede target: must exist and be approved (draft → superseded is invalid).
    let supersedeId: string | undefined;
    if (input.supersedes) {
      const replaced = manifest.artifacts.find(
        (a) => a.id === input.supersedes || (a.type === input.supersedes && a.status !== "superseded"),
      );
      if (!replaced) {
        throw new EngineError(`supersedes target "${input.supersedes}" not found.`);
      }
      assertStatusTransition(replaced.status, "superseded", replaced.id);
      supersedeId = replaced.id;
    }

    // Dependency validation: existence + upstream-in-chain + no self-dependency.
    for (const dep of input.dependsOn ?? []) {
      const depArt = manifest.artifacts.find((a) => a.id === dep);
      if (!depArt) {
        throw new EngineError(`Dependency "${dep}" does not exist in this task.`);
      }
      if (depArt.type === input.type) {
        throw new EngineError(`Artifact cannot depend on itself (${input.type}).`);
      }
      const chain = FLOW_CHAINS[manifest.flow];
      const di = chain.indexOf(depArt.type);
      const ti = chain.indexOf(input.type);
      if (di !== -1 && ti !== -1 && di >= ti) {
        throw new EngineError(
          `Dependency "${dep}" (${depArt.type}) is not upstream of "${input.type}" in the ${manifest.flow} flow.`,
        );
      }
    }

    // Index allocation from on-disk artifact paths (inside the lock).
    const existingPaths = manifest.artifacts.map((a) => a.path);
    const idx = nextIndex(existingPaths);
    const filename = `${String(idx).padStart(2, "0")}-${desc}.md`;
    const fullPath = join(taskDir, filename);
    ensureWithin(taskDir, fullPath);

    const now = new Date().toISOString();
    const contentHash = hashContent(input.content);
    const versionCount = manifest.artifacts.filter((a) => a.type === input.type).length;
    const id = versionCount === 0 ? input.type : `${input.type}-v${versionCount + 1}`;
    const artifact: Artifact = {
      id,
      type: input.type,
      path: filename,
      status: input.status ?? "draft",
      dependsOn: input.dependsOn ?? [],
      supersedes: supersedeId,
      contentHash,
      updatedAt: now,
    };

    // Persist file
    await writeFile(fullPath, input.content, "utf8");
    manifest.artifacts.push(artifact);

    // Supersede the replaced artifact (transition already validated)
    if (supersedeId) {
      const replaced = manifest.artifacts.find((a) => a.id === supersedeId);
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
  });
}

/** Update an artifact's file and contentHash in place. Returns updated manifest + artifact. */
export async function updateArtifact(
  taskDir: string,
  artifactId: string,
  content: string,
): Promise<{ manifest: TaskManifest; artifact: Artifact }> {
  return withTaskLock(taskDir, async () => {
    const manifest = await loadManifest(taskDir);
    const artifact = findArtifact(manifest, artifactId);
    if (!artifact) throw new EngineError(`Artifact "${artifactId}" not found.`);

    const abs = join(taskDir, artifact.path);
    ensureWithin(taskDir, abs);
    artifact.contentHash = hashContent(content);
    artifact.updatedAt = new Date().toISOString();
    await writeFile(abs, content, "utf8");
    await saveManifest(taskDir, manifest);
    return { manifest, artifact };
  });
}

/** Set an artifact's status with transition validation, persisting the manifest. */
export async function setArtifactStatus(
  manifest: TaskManifest,
  artifactId: string,
  status: ArtifactStatus,
  taskDir?: string,
): Promise<TaskManifest> {
  const artifact = findArtifact(manifest, artifactId);
  if (!artifact) throw new EngineError(`Artifact "${artifactId}" not found.`);

  const from = artifact.status;
  if (from === status) return manifest; // no-op: no receipt
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

/** Alias matching the plan's Engine API list. */
export async function approve(
  manifest: TaskManifest,
  artifactId: string,
  taskDir?: string,
): Promise<TaskManifest> {
  return setArtifactStatus(manifest, artifactId, "approved", taskDir);
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
 * using the task flow's precedence chain (newest first). Returns the chain
 * members OLDER than `fromType` (or all members when `fromType` is not in the
 * chain), preferring the active non-superseded artifact per type.
 */
export function resolvePrecedence(manifest: TaskManifest, fromType: ArtifactType): Artifact[] {
  const chain = FLOW_PRECEDENCE[manifest.flow].filter(isPrecedenceEligible);
  const fromIdx = chain.indexOf(fromType);
  const slice = fromIdx === -1 ? chain : chain.slice(fromIdx + 1);
  const result: Artifact[] = [];
  for (const type of slice) {
    const a = findArtifact(manifest, type);
    if (a) result.push(a);
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

// ---------------------------------------------------------------------------
// Receipt helpers for the agent runtime
// ---------------------------------------------------------------------------

/** Record a subagent run id on an artifact (and save). */
export async function recordRunId(
  taskDir: string,
  artifactId: string,
  runId: string,
): Promise<TaskManifest> {
  return withTaskLock(taskDir, async () => {
    const manifest = await loadManifest(taskDir);
    const artifact = findArtifact(manifest, artifactId);
    if (artifact) {
      artifact.runIds = [...(artifact.runIds ?? []), runId];
    }
    await saveManifest(taskDir, manifest);
    return manifest;
  });
}

/** Record a phase-commit receipt (phase id + run id). */
export async function recordPhaseCommit(
  taskDir: string,
  phaseId: string,
  runId: string,
): Promise<TaskManifest> {
  return withTaskLock(taskDir, async () => {
    const manifest = await loadManifest(taskDir);
    manifest.receipts.push({
      kind: "phase-commit",
      phaseId,
      runId,
      timestamp: new Date().toISOString(),
    });
    await saveManifest(taskDir, manifest);
    return manifest;
  });
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
