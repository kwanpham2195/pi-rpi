/**
 * Artifact protocol types: manifest schema v1.
 *
 * Authoritative contracts come from the ExecPlan's "Manifest schema v1" and
 * "Flow tables" sections (.agents/tasks/pi-artifacts/04-pi-artifact-workflow-plan.md).
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
  | "phase-commit"
  | "migration"
  | "drift";

export interface Receipt {
  kind: ReceiptKind;
  artifactId?: string;
  phaseId?: string;
  commitSha?: string;
  detail?: string;
  timestamp: string;
}

export interface Artifact {
  id: string; // slug-unique artifact id within a task
  type: ArtifactType;
  path: string; // relative to the task dir
  status: ArtifactStatus;
  dependsOn: string[]; // artifact ids this artifact depends on
  supersedes?: string; // artifact id this replaced
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

/** Flow chains: enabled artifact types in logical order. */
export const FLOW_CHAINS: Record<Flow, ArtifactType[]> = {
  rpi: [
    "ticket",
    "research-questions",
    "research",
    "design-discussion",
    "structure-outline",
    "plan", // optional
    "implementation",
    "pr-description",
    "mockup",
    "diagram",
  ],
  prd: [
    "ticket",
    "research-questions",
    "research",
    "prd",
    "tdd",
    "structure-outline",
    "plan", // optional
    "implementation",
    "pr-description",
    "mockup",
    "diagram",
  ],
  oneshot: ["ticket", "implementation", "pr-description", "mockup", "diagram"],
  freeform: [...ARTIFACT_TYPES],
};

/**
 * Effective precedence per flow (newest wins). Research-questions are excluded
 * from precedence in every flow.
 */
export const FLOW_PRECEDENCE: Record<Flow, ArtifactType[]> = {
  rpi: ["structure-outline", "design-discussion", "research", "ticket"],
  prd: ["structure-outline", "tdd", "prd", "research", "ticket"],
  oneshot: ["ticket"],
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
