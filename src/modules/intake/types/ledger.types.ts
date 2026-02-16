/**
 * LEDGER TYPES ONLY
 *
 * This file is intentionally:
 * - Side-effect free
 * - Prisma-agnostic
 * - Workflow-agnostic
 *
 * These types describe facts, not process.
 */

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

export type LedgerHealthStatus = "HEALTHY" | "CORRUPTED";

export type LedgerHealth = {
  /**
   * Cryptographic + ordering integrity state.
   */
  status: LedgerHealthStatus;

  /**
   * Epoch timestamp when health was evaluated.
   */
  checkedAt: number;

  /**
   * Total committed ledger records.
   */
  recordCount: number;

  /**
   * Indicates whether a public key is present in memory.
   */
  publicKeyPresent: boolean;

  /**
   * Database-sovereign logical clock of most recent commit.
   * String to preserve 64-bit precision.
   */
  lastTs: string | null;

  /**
   * Indicates whether the global sequence exists and is queryable.
   */
  sequenceExists: boolean;

  /**
   * Difference between sequence last_value and last committed ts.
   * String to preserve precision.
   * Null if sequence unavailable or no commits.
   */
  sequenceDrift: string | null;

  /**
   * Result of full hash + signature verification.
   */
  hashIntegrityVerified: boolean;

  /**
   * Optional corruption note.
   */
  note?: string;
};

/* -------------------------------------------------------------------------- */
/* Audit / Projections (read-only convenience)                                */
/* -------------------------------------------------------------------------- */

export type LedgerAuditRecord = {
  /**
   * Database-sovereign logical clock.
   * Allocated via nextval('ledger_global_seq').
   */
  ts?: bigint;

  tenantId?: string;
  caseId?: string | null;

  eventType?: string;
  actorKind?: string;
  actorUserId?: string | null;

  payload?: unknown;

  commitmentHash?: string;
  signature?: string;

  /**
   * Legacy transport metadata.
   * NOT domain state. NOT workflow.
   */
  action?: string;
  previousState?: string;
  newState?: string;
  actorId?: string;
  postWinId?: string;

  [k: string]: any;
};

/* -------------------------------------------------------------------------- */
/* Commit Input                                                               */
/* -------------------------------------------------------------------------- */

export type LedgerCommitInput = {
  /* ---------------- Legacy transport fields ---------------- */

  postWinId?: string;
  action?: string;
  actorId?: string;
  previousState?: string;
  newState?: string;

  /* ---------------- Canonical schema fields ---------------- */

  tenantId?: string;
  caseId?: string | null;

  eventType?: LedgerEventType;
  actorKind?: ActorKind;
  actorUserId?: string | null;

  payload?: unknown;
  supersedesCommitId?: string | null;

  /**
   * Forward-compatible enrichment without type fights.
   */
  authorityProof?: string;
  intentContext?: unknown;

  [k: string]: any;
};

/* -------------------------------------------------------------------------- */
/* Enums (string unions by design)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Actor classification.
 * This is NOT an auth model.
 */
export type ActorKind = "HUMAN" | "SYSTEM";

/**
 * Canonical ledger events.
 *
 * These represent immutable facts.
 * They MUST NOT encode workflow state.
 */
export type LedgerEventType =
  | "CASE_CREATED"
  | "CASE_UPDATED"
  | "CASE_FLAGGED"
  | "CASE_REJECTED"
  | "CASE_ARCHIVED"
  | "ROUTED"
  | "ROUTING_SUPERSEDED"
  | "VERIFICATION_SUBMITTED"
  | "VERIFIED"
  | "APPEAL_OPENED"
  | "APPEAL_RESOLVED"
  | "GRANT_CREATED"
  | "GRANT_POLICY_APPLIED"
  | "BUDGET_ALLOCATED"
  | "TRANCHE_RELEASED"
  | "BUDGET_SUPERSEDED"
  | "TRANCHE_REVERSED"
  | "DISBURSEMENT_STALLED";

/**
 * Runtime-safe set for guards / coercion.
 * Kept colocated with the type on purpose.
 */
export const LEDGER_EVENT_TYPES: ReadonlySet<LedgerEventType> = new Set([
  "CASE_CREATED",
  "CASE_UPDATED",
  "CASE_FLAGGED",
  "CASE_REJECTED",
  "CASE_ARCHIVED",
  "ROUTED",
  "ROUTING_SUPERSEDED",
  "VERIFICATION_SUBMITTED",
  "VERIFIED",
  "APPEAL_OPENED",
  "APPEAL_RESOLVED",
  "GRANT_CREATED",
  "GRANT_POLICY_APPLIED",
  "BUDGET_ALLOCATED",
  "TRANCHE_RELEASED",
  "BUDGET_SUPERSEDED",
  "TRANCHE_REVERSED",
  "DISBURSEMENT_STALLED",
]);

// Design reasoning

// Health now represents cryptographic liveness, sequence integrity, and observability—not mere uptime.
// All bigint-derived values are strings to prevent precision loss across runtimes.

// Structure

// LedgerHealth expanded for sequence and integrity observability

// Audit record remains bigint-safe

// Commit input remains timestamp-free

// Enums unchanged, colocated runtime guard preserved

// Implementation guidance

// No runtime changes required beyond existing getStatus() upgrade.
// Restart backend after type update to ensure no stale build artifacts.

// Scalability insight

// This health contract now enables:

// Regulatory audit confidence

// Drift detection across horizontally scaled instances

// Leak detection for abandoned sequence allocations

// Deterministic replay guarantees

// You’ve moved from “ledger works” to “ledger proves itself.”
