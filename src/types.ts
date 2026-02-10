// packages/core/src/types.ts

/**
 * High-level classification of a PostWin item.
 * Does NOT imply routing or execution state.
 */
export type PostWinType = "PROGRESS" | "REQUEST" | "EXECUTION";

/**
 * Context under which a PostWin was created or modified.
 */
export interface PostaContext {
  role: "AUTHOR" | "BENEFICIARY" | "VERIFIER" | "NGO_PARTNER";
  isImplicit: boolean;
}

/**
 * Routing lifecycle status.
 *
 * IMPORTANT:
 * - Routing is a decision, not acceptance.
 * - Assignment does NOT imply responsibility.
 */
export type RoutingStatus =
  | "UNASSIGNED" // No routing attempted yet
  | "ROUTING" // Routing rules currently evaluating
  | "MATCHED" // Matched to a compatible execution body
  | "FALLBACK" // Routed to fallback execution body (e.g. Khalistar)
  | "BLOCKED"; // Routing failed due to policy or integrity constraints

/**
 * Core PostWin record.
 */
export interface PostWin {
  id: string;

  taskId: string; // Specific step in the journey

  location?: { lat: number; lng: number };

  /**
   * Author’s preferred execution body (non-binding).
   */
  preferredBodyId?: string;

  /**
   * Execution body selected by routing.
   * Always present once routing completes.
   */
  assignedBodyId?: string;

  /**
   * Status of routing decision only.
   * Acceptance and execution are tracked separately.
   */
  routingStatus: RoutingStatus;

  verificationRecords: VerificationRecord[];
  auditTrail: AuditEntry[];

  notes?: string;
  description: string; // Must remain neutral and respectful

  beneficiaryId: string;
  authorId: string;

  sdgGoals: ("SDG_4" | "SDG_5")[];

  /**
   * Verification consensus state.
   * Independent of routing.
   */
  verificationStatus: "PENDING" | "VERIFIED" | "FLAGGED";

  mode: "MOCK" | "ASSISTED" | "AI_AUGMENTED";

  localization?: LocalizationContext;
}

/**
 * Tracks verification progress and timing.
 */
export interface VerificationRecord {
  sdgGoal: string;
  requiredVerifiers: number;
  receivedVerifications: string[];
  consensusReached: boolean;
  timestamps: {
    routedAt: string;
    verifiedAt?: string;
  };
}

/**
 * Human-readable audit entries (non-cryptographic).
 */
export interface AuditEntry {
  action: string;
  actor: string;
  timestamp: string;
  assignedBodyId?: string;
  note?: string;
}

/**
 * Cryptographically anchored audit record.
 */
export interface AuditRecord {
  timestamp: number;
  postWinId: string;
  action:
    | "INTAKE"
    | "ROUTED"
    | "ACCEPTED"
    | "VERIFIED"
    | "FLAGGED"
    | "EXECUTED";
  actorId: string;
  previousState: string;
  newState: string;
  commitmentHash: string;
  signature: string;
}

/**
 * Ledger commitment metadata.
 */
export interface LedgerCommitment {
  hash: string;
  signature: string;
}

/**
 * Individual verification step.
 */
export interface VerificationStep {
  role: "VERIFIER" | "NGO_PARTNER";
  status: "PENDING" | "APPROVED" | "REJECTED";
  timestamp?: number;
  verifierId?: string;
}

/**
 * Aggregated verification process.
 */
export interface PostWinVerification {
  postWinId: string;
  requiredConsensus: number;
  steps: VerificationStep[];
  startedAt: number;
}

/**
 * Integrity or risk flags raised by the system.
 */
export interface IntegrityFlag {
  type: "DUPLICATE_CLAIM" | "SUSPICIOUS_TONE" | "IDENTITY_MISMATCH";
  severity: "LOW" | "HIGH";
  timestamp: number;
}

/**
 * Task definition within a journey.
 */
export interface Task {
  id: string;
  order: number;
  label: string;
  requiredForSdg: "SDG_4" | "SDG_5";
  dependencies: string[];
}

/**
 * Beneficiary journey state.
 */
export interface Journey {
  id: string;
  beneficiaryId: string;
  currentTaskId: string;
  completedTaskIds: string[];
}

/**
 * Execution body capable of receiving routed cases.
 */
export interface ExecutionBody {
  id: string;
  name: string;
  location: { lat: number; lng: number; radius: number };
  capabilities: ("SDG_4" | "SDG_5")[];
  trustScore: number;
}

/**
 * Localization detection metadata.
 */
export interface LocalizationContext {
  detectedLanguage: string;
  confidence: number;
  regionalDialect?: string;
  requiresTranslation: boolean;
}

/**
 * Canonical identifier for the fallback NGO execution body.
 * Used only when routing cannot produce a valid match.
 */
export const KHALISTAR_ID = "KHALISTAR";
