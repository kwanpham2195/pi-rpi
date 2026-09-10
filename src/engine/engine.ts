/**
 * Artifact engine: the single testable seam for all domain rules.
 *
 * All naming, indexing, dependency/flow validation, precedence resolution,
 * status transitions, supersession, content hashing, and migrations live here.
 * Tools, commands, skills, and the TUI are thin adapters over this module.
 */

import { mkdir, readFile, rename, writeFile, copyFile, access, stat, realpath, unlink } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isWithinRoot } from "../paths.ts";
import {
  type Artifact,
  type ArtifactStatus,
  type ArtifactType,
  type Flow,
  type Receipt,
  type TaskManifest,
  ARTIFACT_TYPES,
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
const TASK_LOCK_FILENAME = ".artifact-manifest.lock";
const TASK_LOCK_TIMEOUT_MS = 5_000;
const TASK_LOCK_STALE_MS = 30_000;
const TASK_LOCK_RETRY_MS = 20;

/** Serialize manifest saves so concurrent writers cannot race the atomic rename. */
let saveQueue: Promise<unknown> = Promise.resolve();
function enqueueSave<T>(fn: () => Promise<T>): Promise<T> {
  const run = saveQueue.then(fn, fn);
  saveQueue = run.catch(() => undefined);
  return run;
}

/** Serialize each canonical task path in this process before taking the local filesystem lock. */
const taskLocks = new Map<string, Promise<unknown>>();
async function withTaskLock<T>(taskDir: string, fn: () => Promise<T>): Promise<T> {
  const canonicalTaskDir = await realpath(taskDir);
  const prev = taskLocks.get(canonicalTaskDir) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => (release = resolveGate));
  const queued = prev.then(() => gate);
  taskLocks.set(canonicalTaskDir, queued);
  await prev;
  try {
    return await withFilesystemTaskLock(canonicalTaskDir, fn);
  } finally {
    release();
    if (taskLocks.get(canonicalTaskDir) === queued) taskLocks.delete(canonicalTaskDir);
  }
}

/** Acquire an exclusive local lock so independent Node processes cannot overwrite each other's manifests. */
async function withFilesystemTaskLock<T>(taskDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(taskDir, TASK_LOCK_FILENAME);
  const owner = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + TASK_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      await writeFile(lockPath, JSON.stringify({ owner, pid: process.pid, createdAt: Date.now() }), { encoding: "utf8", flag: "wx" });
      break;
    } catch (cause: unknown) {
      if (!isFileExistsError(cause)) throw cause;
      await recoverStaleTaskLock(lockPath);
      if (Date.now() >= deadline) throw new EngineError(`Timed out waiting for task lock at ${lockPath}.`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, TASK_LOCK_RETRY_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await releaseFilesystemTaskLock(lockPath, owner);
  }
}

async function recoverStaleTaskLock(lockPath: string): Promise<void> {
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (cause: unknown) {
    if (isFileMissingError(cause)) return;
    throw cause;
  }
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (cause: unknown) {
    if (isFileMissingError(cause)) return;
    throw cause;
  }
  let record: { pid?: unknown; createdAt?: unknown } | undefined;
  try {
    record = JSON.parse(raw) as { pid?: unknown; createdAt?: unknown };
  } catch {
    // A just-created lock can be observed before its JSON write is complete.
    // Its file age is the only trustworthy stale-recovery signal.
    if (Date.now() - lockStat.mtimeMs < TASK_LOCK_STALE_MS) return;
    record = {};
  }
  const pid = typeof record.pid === "number" ? record.pid : undefined;
  if (pid !== undefined && processIsAlive(pid)) return;
  const quarantinedPath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, quarantinedPath);
    await unlink(quarantinedPath);
  } catch (cause: unknown) {
    if (!isFileMissingError(cause)) throw cause;
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause: unknown) {
    return !(typeof cause === "object" && cause !== null && "code" in cause && (cause as { code?: unknown }).code === "ESRCH");
  }
}

async function releaseFilesystemTaskLock(lockPath: string, owner: string): Promise<void> {
  try {
    const record = JSON.parse(await readFile(lockPath, "utf8")) as { owner?: unknown };
    if (record.owner === owner) await unlink(lockPath);
  } catch (cause: unknown) {
    if (!isFileMissingError(cause)) throw cause;
  }
}

function isFileExistsError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && (cause as { code?: unknown }).code === "EEXIST";
}

function isFileMissingError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && (cause as { code?: unknown }).code === "ENOENT";
}
type RollbackStep = { readonly label: string; readonly run: () => Promise<void>; readonly ignoreMissing?: true };

async function rethrowWithRollback(cause: unknown, steps: readonly RollbackStep[]): Promise<never> {
  const rollbackFailures: unknown[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (rollbackCause: unknown) {
      if (!(step.ignoreMissing && isFileMissingError(rollbackCause))) {
        rollbackFailures.push(new AggregateError([rollbackCause], `Rollback step failed: ${step.label}`));
      }
    }
  }
  if (rollbackFailures.length > 0) {
    throw new AggregateError([cause, ...rollbackFailures], "Persistence failed and rollback was incomplete.", { cause });
  }
  throw cause;
}
function synchronizeManifest(target: TaskManifest, source: TaskManifest): TaskManifest {
  Object.assign(target, source);
  return source;
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

/** Convert a human artifact description to a flat filename slug without accepting path-like input. */
function normalizeArtifactDescription(description: string): string {
  if (!description || typeof description !== "string") {
    throw new EngineError("Invalid description: empty.");
  }
  if (/[\\/.]/.test(description)) {
    throw new EngineError(`Invalid description: "${description}". Slashes and dots are not allowed.`);
  }
  const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return validateDescription(slug);
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
    if (part === "." || part === "..") throw new EngineError(`Invalid ${label}: traversal not allowed: ${p}`);
  }
  const safe = normalized.replace(/^\/+/, "");
  if (!safe || safe.includes("\0")) throw new EngineError(`Invalid ${label}: unsafe relative path: ${p}`);
  return safe;
}

export function ensureWithin(root: string, candidate: string): string {
  const rel = relative(root, candidate);
  if (rel === "" || (!rel.startsWith("..") && !relative(root, candidate).startsWith(sep))) {
    return candidate;
  }
  throw new EngineError(`Path escapes ${root}: ${candidate}`);
}

/** Resolve an existing managed artifact without following a symlink outside its task. */
export async function resolveManagedArtifactPath(taskDir: string, artifactPath: string): Promise<string> {
  const canonicalTaskDir = await realpath(taskDir);
  const safePath = safeRelativePath(artifactPath, "artifact.path");
  const lexicalCandidate = resolve(canonicalTaskDir, safePath);
  ensureWithin(canonicalTaskDir, lexicalCandidate);
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(lexicalCandidate);
  } catch (cause: unknown) {
    if (isFileMissingError(cause)) throw cause;
    throw new EngineError(`Unsafe artifact path "${artifactPath}": cannot resolve managed file. ${String(cause)}`);
  }
  if (!isWithinRoot(canonicalTaskDir, canonicalCandidate)) {
    throw new EngineError(`Unsafe artifact path "${artifactPath}": resolves outside task directory.`);
  }
  return canonicalCandidate;
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

async function loadManifestState(taskDir: string): Promise<{ manifest: TaskManifest; migrationApplied: boolean }> {
  const path = manifestPath(taskDir);
  const backup = backupPath(taskDir);
  let raw: string;
  let recovered = false;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause: unknown) {
    if (!isFileMissingError(cause)) throw cause;
    recovered = true;
    try {
      raw = await readFile(backup, "utf8");
    } catch (backupCause: unknown) {
      if (isFileMissingError(backupCause)) throw new EngineError(`Malformed manifest at ${path} and no backup to recover from. ${String(cause)}`);
      throw backupCause;
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause: unknown) {
    try {
      raw = await readFile(backup, "utf8");
    } catch (backupCause: unknown) {
      if (isFileMissingError(backupCause)) throw new EngineError(`Malformed manifest at ${path} and no backup to recover from. ${String(cause)}`);
      throw backupCause;
    }
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new EngineError(`Malformed manifest at ${path} and the backup is also unreadable. ${String(cause)}`);
    }
    recovered = true;
  }
  if (recovered) await writeFile(path, raw, "utf8");
  const rawManifest = parseRecord(parsed, "manifest");
  return { manifest: migrateManifest(rawManifest, taskDir), migrationApplied: rawManifest.schemaVersion !== SCHEMA_VERSION };
}

/** Load and strictly parse a task manifest, recovering from its last good backup when needed. */
export async function loadManifest(taskDir: string): Promise<TaskManifest> {
  return (await loadManifestState(taskDir)).manifest;
}

export async function saveManifest(taskDir: string, manifest: TaskManifest): Promise<void> {
  parseTaskManifest(manifest, taskDir);
  await enqueueSave(async () => {
    const dir = dirname(taskDir);
    await mkdir(dir, { recursive: true });
    const path = manifestPath(taskDir);
    // Atomic write: write a temp file then rename (and back up current first)
    const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
      // Back up the existing manifest if present
      try {
        await access(path);
        await copyFile(path, backupPath(taskDir));
      } catch (cause: unknown) {
        if (!isFileMissingError(cause)) throw cause;
      }
      await rename(tmp, path);
    } catch (cause: unknown) {
      await rethrowWithRollback(cause, [{ label: `remove manifest temp ${tmp}`, run: () => unlink(tmp), ignoreMissing: true }]);
    }
  });
}

function backupPath(taskDir: string): string {
  return join(taskDir, MANIFEST_BACKUP);
}
/** Parse a persisted schema-v1 manifest before it enters engine logic. */
function parseTaskManifest(value: unknown, taskDir: string): TaskManifest {
  const manifest = parseRecord(value, "manifest");
  assertExactKeys(manifest, ["schemaVersion", "id", "slug", "title", "ticketUrl", "flow", "baseBranch", "artifacts", "receipts"], "manifest");
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new EngineError("Invalid manifest.schemaVersion: expected 1.");
  const slug = parseString(manifest.slug, "manifest.slug");
  validateSlug(slug);
  const id = parseString(manifest.id, "manifest.id");
  if (id !== `task-${slug}`) throw new EngineError(`Invalid manifest.id: expected task-${slug}.`);
  const title = parseString(manifest.title, "manifest.title");
  const baseBranch = parseString(manifest.baseBranch, "manifest.baseBranch");
  const flow = parseFlow(manifest.flow, "manifest.flow");
  const ticketUrl = manifest.ticketUrl === undefined ? undefined : parseString(manifest.ticketUrl, "manifest.ticketUrl");
  const artifacts = parseArray(manifest.artifacts, "manifest.artifacts").map((artifact, index) =>
    parseArtifact(artifact, `manifest.artifacts[${index}]`),
  );
  const receipts = parseArray(manifest.receipts, "manifest.receipts").map((receipt, index) =>
    parseReceipt(receipt, `manifest.receipts[${index}]`),
  );
  assertManifestRelationships(artifacts, receipts);
  return { schemaVersion: SCHEMA_VERSION, id, slug, title, ticketUrl, flow, baseBranch, artifacts, receipts };
}

function parseArtifact(value: unknown, field: string): Artifact {
  const artifact = parseRecord(value, field);
  assertExactKeys(artifact, ["id", "type", "path", "status", "dependsOn", "supersedes", "contentHash", "updatedAt", "runIds"], field);
  const type = parseArtifactType(artifact.type, `${field}.type`);
  const id = parseString(artifact.id, `${field}.id`);
  const versionPattern = new RegExp(`^${type}(?:-v(?:[2-9]|[1-9][0-9]+))?$`);
  if (!versionPattern.test(id)) throw new EngineError(`Invalid ${field}.id: must identify its artifact type.`);
  const path = safeRelativePath(parseString(artifact.path, `${field}.path`), `${field}.path`);
  const status = parseArtifactStatus(artifact.status, `${field}.status`);
  const dependsOn = parseStringArray(artifact.dependsOn, `${field}.dependsOn`);
  const supersedes = artifact.supersedes === undefined ? undefined : parseString(artifact.supersedes, `${field}.supersedes`);
  const contentHash = parseString(artifact.contentHash, `${field}.contentHash`);
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new EngineError(`Invalid ${field}.contentHash: expected a SHA-256 hex digest.`);
  const updatedAt = parseTimestamp(artifact.updatedAt, `${field}.updatedAt`);
  const runIds = artifact.runIds === undefined ? undefined : parseStringArray(artifact.runIds, `${field}.runIds`);
  return { id, type, path, status, dependsOn, supersedes, contentHash, updatedAt, runIds };
}

function parseReceipt(value: unknown, field: string): Receipt {
  const receipt = parseRecord(value, field);
  assertExactKeys(receipt, ["kind", "artifactId", "phaseId", "runId", "commitSha", "detail", "timestamp"], field);
  const kind = parseReceiptKind(receipt.kind, `${field}.kind`);
  const artifactId = receipt.artifactId === undefined ? undefined : parseString(receipt.artifactId, `${field}.artifactId`);
  const phaseId = receipt.phaseId === undefined ? undefined : parseString(receipt.phaseId, `${field}.phaseId`);
  const runId = receipt.runId === undefined ? undefined : parseString(receipt.runId, `${field}.runId`);
  const commitSha = receipt.commitSha === undefined ? undefined : parseString(receipt.commitSha, `${field}.commitSha`);
  const detail = receipt.detail === undefined ? undefined : parseString(receipt.detail, `${field}.detail`);
  const timestamp = parseTimestamp(receipt.timestamp, `${field}.timestamp`);
  assertReceiptFields(kind, { artifactId, phaseId, runId, commitSha, detail }, field);
  return { kind, artifactId, phaseId, runId, commitSha, detail, timestamp };
}

function assertReceiptFields(kind: Receipt["kind"], fields: Omit<Receipt, "kind" | "timestamp">, field: string): void {
  const required: Record<Receipt["kind"], Array<keyof typeof fields>> = {
    "status-change": ["artifactId"], approval: ["artifactId"], drift: ["artifactId", "detail"],
    "flow-change": ["detail"], "base-branch-change": ["detail"], "phase-commit": ["phaseId", "runId", "commitSha"],
    "agent-run": ["runId", "detail"], migration: ["detail"],
  };
  const allowed: Record<Receipt["kind"], Array<keyof typeof fields>> = {
    "status-change": ["artifactId", "detail"], approval: ["artifactId"], drift: ["artifactId", "detail"],
    "flow-change": ["detail"], "base-branch-change": ["detail"], "phase-commit": ["phaseId", "runId", "commitSha"],
    "agent-run": ["runId", "detail"], migration: ["detail"],
  };
  for (const name of required[kind]) if (fields[name] === undefined) throw new EngineError(`Invalid ${field}.${name}: required for ${kind}.`);
  for (const name of Object.keys(fields) as Array<keyof typeof fields>) {
    if (fields[name] !== undefined && !allowed[kind].includes(name)) throw new EngineError(`Invalid ${field}.${name}: unrelated to ${kind}.`);
  }
  if (kind === "phase-commit" && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(fields.commitSha ?? "")) throw new EngineError(`Invalid ${field}.commitSha: expected a canonical full Git object ID.`);
}

function assertManifestRelationships(artifacts: Artifact[], receipts: Receipt[]): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  const activeTypes = new Set<ArtifactType>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) throw new EngineError(`Invalid manifest.artifacts: duplicate artifact id "${artifact.id}".`);
    if (paths.has(artifact.path)) throw new EngineError(`Invalid manifest.artifacts: duplicate artifact path "${artifact.path}".`);
    if (artifact.status !== "superseded") {
      if (activeTypes.has(artifact.type)) throw new EngineError(`Invalid manifest.artifacts: duplicate active artifact type "${artifact.type}".`);
      activeTypes.add(artifact.type);
    }
    ids.add(artifact.id);
    paths.add(artifact.path);
  }
  for (const artifact of artifacts) {
    if (new Set(artifact.dependsOn).size !== artifact.dependsOn.length) throw new EngineError(`Invalid artifact "${artifact.id}".dependsOn: duplicate dependency.`);
    for (const dependencyId of artifact.dependsOn) {
      if (dependencyId === artifact.id || !ids.has(dependencyId)) throw new EngineError(`Invalid artifact "${artifact.id}".dependsOn: unknown dependency "${dependencyId}".`);
    }
    if (artifact.supersedes !== undefined) {
      const replaced = artifacts.find((candidate) => candidate.id === artifact.supersedes);
      if (!replaced) throw new EngineError(`Invalid artifact "${artifact.id}".supersedes: unknown artifact "${artifact.supersedes}".`);
      if (replaced.type !== artifact.type || replaced.status !== "superseded") throw new EngineError(`Invalid artifact "${artifact.id}".supersedes: must reference a superseded artifact of the same type.`);
      const visited = new Set<string>([artifact.id]);
      let cursor: Artifact | undefined = artifact;
      while (cursor?.supersedes !== undefined) {
        if (visited.has(cursor.supersedes)) throw new EngineError(`Invalid artifact "${artifact.id}".supersedes: cyclic supersession chain.`);
        visited.add(cursor.supersedes);
        cursor = artifacts.find((candidate) => candidate.id === cursor?.supersedes);
      }
    }
  }
  for (const receipt of receipts) {
    if (receipt.artifactId !== undefined && !ids.has(receipt.artifactId)) throw new EngineError(`Invalid receipt.artifactId: unknown artifact "${receipt.artifactId}".`);
  }
}

function parseRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new EngineError(`Invalid ${field}: expected object.`);
  return value as Record<string, unknown>; // SAFETY: the object check establishes the record boundary used only by this parser.
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new EngineError(`Invalid ${field}.${key}: unknown field.`);
  }
}

function parseArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new EngineError(`Invalid ${field}: expected array.`);
  return value;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new EngineError(`Invalid ${field}: expected non-empty string.`);
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  return parseArray(value, field).map((entry, index) => parseString(entry, `${field}[${index}]`));
}

function parseTimestamp(value: unknown, field: string): string {
  const timestamp = parseString(value, field);
  if (Number.isNaN(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) throw new EngineError(`Invalid ${field}: expected ISO-8601 timestamp.`);
  return timestamp;
}

function parseArtifactType(value: unknown, field: string): ArtifactType {
  const type = parseString(value, field);
  if (!ARTIFACT_TYPES.includes(type as ArtifactType)) throw new EngineError(`Invalid ${field}: unknown artifact type "${type}".`);
  return type as ArtifactType; // SAFETY: ARTIFACT_TYPES membership establishes the ArtifactType union.
}

function parseArtifactStatus(value: unknown, field: string): ArtifactStatus {
  const status = parseString(value, field);
  if (status !== "draft" && status !== "in-review" && status !== "approved" && status !== "superseded") throw new EngineError(`Invalid ${field}: unknown artifact status "${status}".`);
  return status;
}

function parseFlow(value: unknown, field: string): Flow {
  const flow = parseString(value, field);
  if (flow !== "rpi" && flow !== "prd" && flow !== "oneshot" && flow !== "freeform") throw new EngineError(`Invalid ${field}: unknown flow "${flow}".`);
  return flow;
}

function parseReceiptKind(value: unknown, field: string): Receipt["kind"] {
  const kind = parseString(value, field);
  if (kind !== "status-change" && kind !== "approval" && kind !== "flow-change" && kind !== "base-branch-change" && kind !== "phase-commit" && kind !== "agent-run" && kind !== "migration" && kind !== "drift") throw new EngineError(`Invalid ${field}: unknown receipt kind "${kind}".`);
  return kind;
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
  await mkdir(taskDir, { recursive: true });
  return withTaskLock(taskDir, async () => {
    const existing = await tryLoadManifest(taskDir);
    if (existing) return existing;
    const manifest = newManifest({ slug: input.slug, title: input.title, flow: input.flow, baseBranch: input.baseBranch, ticketUrl: input.ticketUrl });
    let createdTicketPath: string | undefined;
    if (input.ticketBody !== undefined) {
      const ticketPath = "ticket.md";
      const content = input.ticketBody;
      manifest.artifacts.push({ id: "ticket", type: "ticket", path: ticketPath, status: "approved", dependsOn: [], contentHash: hashContent(content), updatedAt: new Date().toISOString() });
      parseTaskManifest(manifest, taskDir);
      try {
        createdTicketPath = join(taskDir, ticketPath);
        await writeFile(createdTicketPath, content, { encoding: "utf8", flag: "wx" });
      } catch (cause: unknown) {
        if (isFileExistsError(cause)) throw new EngineError(`unmanaged artifact file collision at ${join(taskDir, ticketPath)}; refusing to overwrite it.`);
        throw cause;
      }
    }
    try {
      await saveManifest(taskDir, manifest);
    } catch (cause: unknown) {
      if (createdTicketPath === undefined) throw cause;
      await rethrowWithRollback(cause, [{ label: `remove ticket ${createdTicketPath}`, run: () => unlink(createdTicketPath) }]);
    }
    return manifest;
  });
}

/** Open a task; returns undefined (not error) if it does not exist. */
export async function tryLoadManifest(taskDir: string): Promise<TaskManifest | null> {
  try {
    await access(manifestPath(taskDir));
  } catch (cause: unknown) {
    if (isFileMissingError(cause)) return null;
    throw cause;
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
  return withTaskLock(taskDir, async () => {
    const { manifest, migrationApplied } = await loadManifestState(taskDir);
    if (migrationApplied) await saveManifest(taskDir, manifest);
    // Drift check: contentHash vs file for each artifact.
    for (const a of manifest.artifacts) {
      try {
        const artifactPath = await resolveManagedArtifactPath(taskDir, a.path);
        const h = await hashFile(artifactPath);
        if (h !== a.contentHash) {
          manifest.receipts.push({
            kind: "drift",
            artifactId: a.id,
            detail: "contentHash mismatch on open",
            timestamp: new Date().toISOString(),
          });
          await saveManifest(taskDir, manifest);
          break;
        }
      } catch (cause: unknown) {
        if (!isFileMissingError(cause)) throw cause;
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
  });
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrate a legacy manifest that lacks `flow`/`receipts[]`.
 * Defaults flow to `rpi` and records a migration receipt.
 */
export function migrateManifest(parsed: unknown, taskDir: string): TaskManifest {
  const raw = parseRecord(parsed, "manifest");
  if (raw.schemaVersion === SCHEMA_VERSION) return parseTaskManifest(raw, taskDir);
  if (raw.schemaVersion !== undefined) throw new EngineError("Invalid manifest.schemaVersion: expected 1.");
  const manifest = newManifest({
    slug: typeof raw.slug === "string" ? raw.slug : "unknown",
    title: typeof raw.title === "string" ? raw.title : typeof raw.slug === "string" ? raw.slug : "untitled task",
    flow: raw.flow === undefined ? "rpi" : parseFlow(raw.flow, "manifest.flow"),
    baseBranch: typeof raw.baseBranch === "string" ? raw.baseBranch : "main",
    ticketUrl: raw.ticketUrl === undefined ? undefined : parseString(raw.ticketUrl, "manifest.ticketUrl"),
  });
  if (Array.isArray(raw.artifacts)) {
    manifest.artifacts = raw.artifacts.map((artifact, index) => parseArtifact(artifact, `manifest.artifacts[${index}]`));
  }
  manifest.receipts = [
    {
      kind: "migration",
      detail: `Schema normalized to v1; flow=${manifest.flow}, receipts initialized.`,
      timestamp: new Date().toISOString(),
    },
  ];
  return parseTaskManifest(manifest, taskDir);
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

/** Return the exact required dependency for a flow-spine artifact. */
function requiredDependencyIds(manifest: TaskManifest, type: ArtifactType): string[] | undefined {
  if (manifest.flow === "freeform" || ["ticket", "mockup", "diagram", "pr-walkthrough"].includes(type)) return undefined;
  if (type === "research-questions") return [];
  if (manifest.flow === "rpi") {
    if (type === "research") return [requiredActiveId(manifest, "research-questions", type)];
    if (type === "design-discussion") return [requiredActiveId(manifest, "research", type)];
    if (type === "structure-outline") return [requiredActiveId(manifest, "design-discussion", type)];
    if (type === "plan") return [requiredActiveId(manifest, "structure-outline", type)];
  }
  if (manifest.flow === "prd") {
    if (type === "research") return [requiredActiveId(manifest, "research-questions", type)];
    if (type === "prd") return [requiredActiveId(manifest, "research", type)];
    if (type === "tdd") return [requiredActiveId(manifest, "prd", type)];
    if (type === "structure-outline") return [requiredActiveId(manifest, "tdd", type)];
    if (type === "plan") return [requiredActiveId(manifest, "structure-outline", type)];
  }
  if (type === "implementation") {
    const plan = findArtifact(manifest, "plan");
    if (plan) return [plan.id];
    if (manifest.flow === "oneshot") return [requiredActiveId(manifest, "ticket", type)];
    return [requiredActiveId(manifest, "structure-outline", type)];
  }
  if (type === "pr-description") return [requiredActiveId(manifest, "implementation", type)];
  return undefined;
}

function requiredActiveId(manifest: TaskManifest, predecessor: ArtifactType, type: ArtifactType): string {
  const artifact = findArtifact(manifest, predecessor);
  if (!artifact) throw new EngineError(`Artifact type "${type}" requires active predecessor "${predecessor}".`);
  return artifact.id;
}

export type SuggestedTaskActionKind = "review" | "iterate" | "create" | "implement" | "describe-pr" | "complete";

/** A non-binding action suggestion derived from the task's current manifest state. */
export interface SuggestedTaskAction {
  kind: SuggestedTaskActionKind;
  label: string;
  artifactType?: ArtifactType;
  optional?: true;
}

const OPTIONAL_SUGGESTION_ARTIFACT_TYPES = new Set<ArtifactType>(["ticket", "plan", "mockup", "diagram", "pr-walkthrough"]);

function isArtifactCreationReady(manifest: TaskManifest, type: ArtifactType): boolean {
  if (findArtifact(manifest, type)) return false;
  try {
    const dependencies = requiredDependencyIds(manifest, type);
    return dependencies === undefined || dependencies.every((id) => findArtifact(manifest, id)?.status === "approved");
  } catch (cause) {
    if (cause instanceof EngineError) return false;
    throw cause;
  }
}

function suggestedCreationAction(manifest: TaskManifest, type: ArtifactType, optional = false): SuggestedTaskAction {
  if (type === "implementation") {
    const plan = findArtifact(manifest, "plan");
    return { kind: "implement", label: plan?.status === "approved" ? "implement plan" : "implement outline", artifactType: type };
  }
  if (type === "pr-description") return { kind: "describe-pr", label: "describe pull request", artifactType: type };
  return { kind: "create", label: `create ${type}${optional ? " (optional)" : ""}`, artifactType: type, ...(optional ? { optional: true as const } : {}) };
}

/**
 * Suggest safe next task actions without imposing a workflow stage. Suggestions
 * reflect the manifest's existing dependency rules; createArtifact remains the
 * authoritative enforcement boundary.
 */
export function suggestTaskActions(manifest: TaskManifest): SuggestedTaskAction[] {
  const activeArtifacts = manifest.artifacts.filter((artifact) => artifact.status !== "superseded");
  const suggestionsForArtifacts = (artifacts: typeof activeArtifacts): SuggestedTaskAction[] => [
    ...artifacts
      .filter((artifact) => artifact.status === "in-review")
      .map((artifact) => ({ kind: "review" as const, label: `review ${artifact.id} for approval`, artifactType: artifact.type })),
    ...artifacts
      .filter((artifact) => artifact.status === "draft")
      .map((artifact) => ({ kind: "iterate" as const, label: `iterate ${artifact.id}`, artifactType: artifact.type })),
  ];
  const requiredArtifactSuggestions = suggestionsForArtifacts(
    activeArtifacts.filter((artifact) => !OPTIONAL_SUGGESTION_ARTIFACT_TYPES.has(artifact.type)),
  );
  const optionalArtifactSuggestions = suggestionsForArtifacts(
    activeArtifacts.filter((artifact) => OPTIONAL_SUGGESTION_ARTIFACT_TYPES.has(artifact.type)),
  );
  if (requiredArtifactSuggestions.length > 0) return requiredArtifactSuggestions;

  if (manifest.flow === "freeform") {
    return [{ kind: "create", label: "choose an artifact that fits the work" }];
  }

  const requiredTypes = FLOW_CHAINS[manifest.flow].filter((type) => !OPTIONAL_SUGGESTION_ARTIFACT_TYPES.has(type));
  const primaryActions = requiredTypes
    .filter((type) => isArtifactCreationReady(manifest, type))
    .map((type) => suggestedCreationAction(manifest, type));
  const optionalActions = (["plan", "mockup", "diagram"] as const)
    .filter((type) => isTypeEnabled(manifest.flow, type) && isArtifactCreationReady(manifest, type))
    .map((type) => suggestedCreationAction(manifest, type, true));

  if (primaryActions.length > 0) return [...primaryActions, ...optionalArtifactSuggestions, ...optionalActions];
  if (requiredTypes.every((type) => findArtifact(manifest, type)?.status === "approved")) {
    return [{ kind: "complete", label: "workflow complete" }, ...optionalArtifactSuggestions, ...optionalActions];
  }
  if (optionalArtifactSuggestions.length > 0) return optionalArtifactSuggestions;
  return optionalActions;
}

// ---------------------------------------------------------------------------
// Artifact operations
// ---------------------------------------------------------------------------

export interface CreateArtifactInput {
  type: ArtifactType;
  description: string; // human description normalized to a filename slug, e.g. "Parent child tracking"
  dependsOn: string[];
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
    const desc = normalizeArtifactDescription(input.description);

    // Duplicate-type rejection unless superseding
    const activeSameType = manifest.artifacts.find(
      (a) => a.type === input.type && a.status !== "superseded",
    );
    if (activeSameType && !input.supersedes) {
      throw new EngineError(
        `Artifact type "${input.type}" already exists (${activeSameType.path}). Update it in place with rpi_update_artifact, or pass supersedes to replace it.`,
      );
    }

    // A replacement must supersede exactly one active, approved artifact of its own type.
    let supersedeId: string | undefined;
    if (input.supersedes) {
      const activeTargets = manifest.artifacts.filter(
        (artifact) => artifact.type === input.type && artifact.status !== "superseded",
      );
      if (activeTargets.length !== 1) {
        throw new EngineError(`supersedes requires exactly one active "${input.type}" artifact.`);
      }
      const requested = input.supersedes === input.type
        ? activeTargets[0]
        : manifest.artifacts.find((artifact) => artifact.id === input.supersedes);
      if (!requested) throw new EngineError(`supersedes target "${input.supersedes}" not found or is already superseded.`);
      if (requested.type !== input.type) {
        throw new EngineError(`supersedes target "${requested.id}" has type "${requested.type}", expected "${input.type}".`);
      }
      const replaced = activeTargets[0];
      if (!replaced) throw new EngineError(`supersedes requires exactly one active "${input.type}" artifact.`);
      if (requested.id !== replaced.id) {
        throw new EngineError(`supersedes target "${requested.id}" is not the active "${input.type}" artifact.`);
      }
      assertStatusTransition(replaced.status, "superseded", replaced.id);
      supersedeId = replaced.id;
    }

    if (!Array.isArray(input.dependsOn)) {
      throw new EngineError("dependsOn must be provided as an array.");
    }
    const requiredDependencies = requiredDependencyIds(manifest, input.type);
    const dependencyIds = parseStringArray(input.dependsOn, "dependsOn");
    if (new Set(dependencyIds).size !== dependencyIds.length) {
      throw new EngineError("Invalid dependsOn: duplicate dependency.");
    }
    if (requiredDependencies !== undefined && (dependencyIds.length !== requiredDependencies.length || dependencyIds.some((id, index) => id !== requiredDependencies[index]))) {
      throw new EngineError(`Artifact type "${input.type}" requires dependsOn: [${requiredDependencies.join(", ")}].`);
    }
    // Dependency validation: existence + upstream-in-chain + no self-dependency.
    for (const dep of dependencyIds) {
      const depArt = manifest.artifacts.find((a) => a.id === dep);
      if (!depArt) {
        throw new EngineError(`Dependency "${dep}" does not exist in this task.`);
      }
      if (depArt.type === input.type) {
        throw new EngineError(`Artifact cannot depend on itself (${input.type}).`);
      }
      if (input.type !== "ticket" && depArt.status !== "approved") {
        throw new EngineError(
          `Dependency "${depArt.id}" has status "${depArt.status}"; approve it before creating "${input.type}".`,
        );
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

    // Index allocation from stored manifest artifact paths (inside the lock).
    const existingPaths = manifest.artifacts.map((a) => a.path);
    const idx = nextIndex(existingPaths);
    const filename = `${String(idx).padStart(2, "0")}-${input.type}-${desc}.md`;
    const canonicalTaskDir = await realpath(taskDir);
    const fullPath = resolve(canonicalTaskDir, filename);
    ensureWithin(canonicalTaskDir, fullPath);
    const now = new Date().toISOString();
    const contentHash = hashContent(input.content);
    const versionCount = manifest.artifacts.filter((a) => a.type === input.type).length;
    const id = versionCount === 0 ? input.type : `${input.type}-v${versionCount + 1}`;
    const artifact: Artifact = {
      id,
      type: input.type,
      path: filename,
      status: input.status ?? "draft",
      dependsOn: dependencyIds,
      supersedes: supersedeId,
      contentHash,
      updatedAt: now,
    };

    // Exclusive creation closes the check-then-write collision window.
    try {
      await writeFile(fullPath, input.content, { encoding: "utf8", flag: "wx" });
    } catch (cause: unknown) {
      if (isFileExistsError(cause)) {
        throw new EngineError(`unmanaged artifact file collision at ${fullPath}; refusing to overwrite it.`);
      }
      throw cause;
    }
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

    try {
      await saveManifest(taskDir, manifest);
    } catch (cause: unknown) {
      await rethrowWithRollback(cause, [{ label: `remove artifact ${fullPath}`, run: () => unlink(fullPath) }]);
    }
    return { manifest, artifact, path: fullPath };
  });
}

/** Read a managed artifact only after canonical containment has been verified. */
export async function readArtifact(taskDir: string, artifactId: string): Promise<string> {
  const manifest = await loadManifest(taskDir);
  const artifact = findArtifact(manifest, artifactId);
  if (!artifact) throw new EngineError(`Artifact "${artifactId}" not found.`);
  const abs = await resolveManagedArtifactPath(taskDir, artifact.path);
  return readFile(abs, "utf8");
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

    const abs = await resolveManagedArtifactPath(taskDir, artifact.path);
    artifact.contentHash = hashContent(content);
    artifact.updatedAt = new Date().toISOString();
    const temporaryPath = `${abs}.tmp-${process.pid}-${randomUUID()}`;
    const rollbackPath = `${abs}.rollback-${process.pid}-${randomUUID()}`;
    let rollbackCopyCreated = false;
    let replacementInstalled = false;
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
      await copyFile(abs, rollbackPath, fsConstants.COPYFILE_EXCL);
      rollbackCopyCreated = true;
      await rename(temporaryPath, abs);
      replacementInstalled = true;
      await saveManifest(taskDir, manifest);
    } catch (cause: unknown) {
      const steps: RollbackStep[] = [{ label: `remove artifact temp ${temporaryPath}`, run: () => unlink(temporaryPath), ignoreMissing: true }];
      if (replacementInstalled) steps.push({ label: `restore artifact ${abs}`, run: () => rename(rollbackPath, abs) });
      else if (rollbackCopyCreated) steps.push({ label: `remove artifact rollback copy ${rollbackPath}`, run: () => unlink(rollbackPath) });
      await rethrowWithRollback(cause, steps);
    }
    try {
      await unlink(rollbackPath);
    } catch (cause: unknown) {
      throw new AggregateError([cause], "Artifact update was saved, but rollback backup cleanup failed.", { cause });
    }
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
  const mutate = async (freshManifest: TaskManifest): Promise<TaskManifest> => {
    const artifact = findArtifact(freshManifest, artifactId);
    if (!artifact) throw new EngineError(`Artifact "${artifactId}" not found.`);
    const from = artifact.status;
    if (from === status) return freshManifest;
    assertStatusTransition(from, status, artifact.id);
    artifact.status = status;
    freshManifest.receipts.push({
      kind: status === "approved" ? "approval" : "status-change",
      artifactId: artifact.id,
      timestamp: new Date().toISOString(),
    });
    return freshManifest;
  };
  if (!taskDir) return mutate(manifest);
  return withTaskLock(taskDir, async () => {
    const freshManifest = await loadManifest(taskDir);
    const updated = await mutate(freshManifest);
    await saveManifest(taskDir, updated);
    return synchronizeManifest(manifest, updated);
  });
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
  const mutate = async (freshManifest: TaskManifest): Promise<TaskManifest> => {
    // Ticket is task input; mockup and diagram are supporting material, not flow-spine blockers.
    const nowDisabled = freshManifest.artifacts.filter(
      (artifact) => !["ticket", "mockup", "diagram"].includes(artifact.type) && !isTypeEnabled(flow, artifact.type),
    );
    if (nowDisabled.length > 0) {
      throw new EngineError(
        `Cannot change flow to "${flow}": existing artifacts are not enabled in that flow: ${nowDisabled
          .map((artifact) => artifact.id)
          .join(", ")}. Supersede or delete them first.`,
      );
    }
    const old = freshManifest.flow;
    if (old === flow) return freshManifest;
    freshManifest.flow = flow;
    freshManifest.receipts.push({
      kind: "flow-change",
      detail: `${old} -> ${flow}`,
      timestamp: new Date().toISOString(),
    });
    return freshManifest;
  };
  if (!taskDir) return mutate(manifest);
  return withTaskLock(taskDir, async () => {
    const freshManifest = await loadManifest(taskDir);
    const updated = await mutate(freshManifest);
    await saveManifest(taskDir, updated);
    return synchronizeManifest(manifest, updated);
  });
}

/** Change a task's Git base branch and record the selected ref. */
export async function setBaseBranch(
  manifest: TaskManifest,
  baseBranch: string,
  taskDir?: string,
): Promise<TaskManifest> {
  const nextBaseBranch = baseBranch.trim();
  if (!nextBaseBranch) throw new EngineError("Base branch must not be empty.");
  const mutate = async (freshManifest: TaskManifest): Promise<TaskManifest> => {
    if (freshManifest.baseBranch === nextBaseBranch) return freshManifest;
    const previousBaseBranch = freshManifest.baseBranch;
    freshManifest.baseBranch = nextBaseBranch;
    freshManifest.receipts.push({
      kind: "base-branch-change",
      detail: `${previousBaseBranch} -> ${nextBaseBranch}`,
      timestamp: new Date().toISOString(),
    });
    return freshManifest;
  };
  if (!taskDir) return mutate(manifest);
  return withTaskLock(taskDir, async () => {
    const freshManifest = await loadManifest(taskDir);
    const updated = await mutate(freshManifest);
    await saveManifest(taskDir, updated);
    return synchronizeManifest(manifest, updated);
  });
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
    if (!artifact) throw new EngineError(`Artifact "${artifactId}" not found.`);
    artifact.runIds = [...(artifact.runIds ?? []), runId];
    await saveManifest(taskDir, manifest);
    return manifest;
  });
}

/** Record an agent run at task scope when no destination artifact exists yet. */
export async function recordTaskRun(taskDir: string, runId: string, detail: string): Promise<TaskManifest> {
  return withTaskLock(taskDir, async () => {
    const manifest = await loadManifest(taskDir);
    manifest.receipts.push({ kind: "agent-run", runId, detail, timestamp: new Date().toISOString() });
    await saveManifest(taskDir, manifest);
    return manifest;
  });
}

/** Record a phase-commit receipt after its commit SHA has been verified by the extension. */
export async function recordPhaseCommit(
  taskDir: string,
  phaseId: string,
  runId: string,
  commitSha: string,
): Promise<TaskManifest> {
  return withTaskLock(taskDir, async () => {
    const manifest = await loadManifest(taskDir);
    manifest.receipts.push({
      kind: "phase-commit",
      phaseId,
      runId,
      commitSha,
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
  } catch (cause: unknown) {
    if (isFileMissingError(cause)) return false;
    throw cause;
  }
}
