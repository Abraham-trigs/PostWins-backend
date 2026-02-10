/**
 * LEDGER TYPES ONLY
 *
 * This file is intentionally:
 * - Side-effect free
 * - Prisma-agnostic
 * - Workflow-agnostic
 *
 * These types describe *facts*, not process.
 */

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export type LedgerHealthStatus = "HEALTHY" | "CORRUPTED";

export type LedgerHealth = {
  status: LedgerHealthStatus;
  checkedAt: number;
  recordCount: number;
  publicKeyPresent: boolean;
  note?: string;
};

/* -------------------------------------------------------------------------- */
/* Audit / Projections (read-only convenience)                                 */
/* -------------------------------------------------------------------------- */

export type LedgerAuditRecord = {
  ts?: number | bigint;

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
/* Commit Input                                                                */
/* -------------------------------------------------------------------------- */

export type LedgerCommitInput = {
  /**
   * Always required.
   * BigInt preferred for canonical storage.
   */
  ts: number | bigint;

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
   * Allow forward-compatible enrichment without type fights.
   */
  [k: string]: any;
};

/* -------------------------------------------------------------------------- */
/* Enums (string unions by design)                                             */
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
