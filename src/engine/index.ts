/** Public API surface for the artifact engine. */

export * from "./types.ts";
export {
  EngineError,
  validateSlug,
  hashContent,
  hashFile,
  safeRelativePath,
  ensureWithin,
  nextIndex,
  manifestPath,
  taskDirFor,
  loadManifest,
  saveManifest,
  createTask,
  tryLoadManifest,
  openTask,
  migrateManifest,
  createArtifact,
  updateArtifact,
  setArtifactStatus,
  assertStatusTransition,
  resolvePrecedence,
  changeFlow,
  fileExists,
} from "./engine.ts";
export type {
  OpenTaskResult,
  CreateTaskInput,
  CreateArtifactInput,
  CreateArtifactResult,
} from "./engine.ts";
