/**
 * Artifact protocol types: manifest schema v1.
 *
 * Authoritative contracts come from the ExecPlan's "Manifest schema v1" and
 * "Flow tables" sections (.agents/tasks/pi-artifacts/04-pi-artifact-workflow-plan.md),
 * with two documented refinements from review:
 * - `plan` is the newest member of rpi/prd precedence (skills and README state
 *   `plan > outline > ...`).
 * - `mockup`, `diagram`, and `pr-walkthrough` are AUXILIARY supporting artifacts
 *   allowed in rpi/prd/oneshot even though the plan's
 *   chains list only the document spine. `ticket` is created by `createTask`,
 *   not via a flow chain, so it is not listed in the rpi/prd chains.
 */

export type ArtifactType =
  | "ticket"
  | "research-questions"
  | "research"
  | "design-discussion"
  | "prd"
  | "tdd"
  | "structure-outline"
  | "plan"
  | "mockup"
  | "diagram"
  | "implementation"
  | "pr-walkthrough"
  | "pr-description";

export type ArtifactStatus = "draft" | "in-review" | "approved" | "superseded";

export type Flow = "rpi" | "prd" | "oneshot" | "freeform";

export type ReceiptKind =
  | "status-change"
  | "approval"
  | "flow-change"
  | "base-branch-change"
  | "phase-commit"
  | "agent-run"
  | "migration"
  | "drift";

export interface Receipt {
  kind: ReceiptKind;
  artifactId?: string;
  phaseId?: string;
  runId?: string;
  commitSha?: string;
  detail?: string;
  timestamp: string;
}

export interface Artifact {
  id: string; // unique id; for the first version of a type it equals the type
  type: ArtifactType;
  path: string; // relative to the task dir
  status: ArtifactStatus;
  dependsOn: string[]; // artifact ids this artifact depends on
  supersedes?: string; // artifact id this replaced (older version)
  contentHash: string;
  updatedAt: string;
  runIds?: string[]; // subagent run IDs that produced evidence for it
}

export interface TaskManifest {
  schemaVersion: 1;
  id: string;
  slug: string;
  title: string;
  ticketUrl?: string;
  flow: Flow;
  baseBranch: string;
  artifacts: Artifact[];
  receipts: Receipt[];
}

export const SCHEMA_VERSION = 1 as const;

/** All artifact types, in logical creation order. */
export const ARTIFACT_TYPES: ArtifactType[] = [
  "ticket",
  "research-questions",
  "research",
  "design-discussion",
  "prd",
  "tdd",
  "structure-outline",
  "plan",
  "mockup",
  "diagram",
  "implementation",
  "pr-walkthrough",
  "pr-description",
];

/**
 * Flow chains: enabled artifact types. `plan` is optional on top of outline in
 * rpi/prd; `mockup`/`diagram`/`pr-walkthrough` are auxiliary supporting artifacts.
 */
export const FLOW_CHAINS: Record<Flow, ArtifactType[]> = {
  rpi: [
    "research-questions",
    "research",
    "design-discussion",
    "structure-outline",
    "plan", // optional
    "implementation",
    "pr-description",
    "mockup", // auxiliary
    "diagram", // auxiliary
    "pr-walkthrough", // auxiliary
  ],
  prd: [
    "research-questions",
    "research",
    "prd",
    "tdd",
    "structure-outline",
    "plan", // optional
    "implementation",
    "pr-description",
    "mockup", // auxiliary
    "diagram", // auxiliary
    "pr-walkthrough", // auxiliary
  ],
  oneshot: ["ticket", "implementation", "pr-description", "mockup", "diagram", "pr-walkthrough"],
  freeform: [...ARTIFACT_TYPES],
};

/**
 * Effective precedence per flow (newest wins). Research-questions are excluded
 * from precedence in every flow. `plan` is the newest member when present.
 */
export const FLOW_PRECEDENCE: Record<Flow, ArtifactType[]> = {
  rpi: ["plan", "structure-outline", "design-discussion", "research", "ticket"],
  prd: ["plan", "structure-outline", "tdd", "prd", "research", "ticket"],
  oneshot: [],
  freeform: [],
};

/** Type is enabled (creatable) in a flow. Plan is optional in rpi/prd. */
export function isTypeEnabled(flow: Flow, type: ArtifactType): boolean {
  return FLOW_CHAINS[flow].includes(type);
}

/** Research-questions are never part of any precedence chain. */
export function isPrecedenceEligible(type: ArtifactType): boolean {
  return type !== "research-questions";
}
