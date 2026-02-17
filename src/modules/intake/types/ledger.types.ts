/**
 * LEDGER TYPES ONLY
 *
 * - Side-effect free
 * - Prisma-agnostic at runtime
 * - Workflow-agnostic
 */

import type { LedgerEventType, ActorKind } from "@prisma/client";

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

export type LedgerHealthStatus = "HEALTHY" | "CORRUPTED";

export type LedgerHealth = {
  status: LedgerHealthStatus;
  checkedAt: number;
  recordCount: number;
  publicKeyPresent: boolean;
  lastTs: string | null;
  sequenceExists: boolean;
  sequenceDrift: string | null;
  hashIntegrityVerified: boolean;
  note?: string;
};

/* -------------------------------------------------------------------------- */
/* Audit Record                                                               */
/* -------------------------------------------------------------------------- */

export type LedgerAuditRecord = {
  ts?: bigint;

  tenantId?: string;
  caseId?: string | null;

  eventType?: LedgerEventType;
  actorKind?: ActorKind;
  actorUserId?: string | null;

  payload?: unknown;

  commitmentHash?: string;
  signature?: string;

  // Legacy transport metadata — NOT domain state
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
  postWinId?: string;
  action?: string;
  actorId?: string;
  previousState?: string;
  newState?: string;

  tenantId?: string;
  caseId?: string | null;

  eventType?: LedgerEventType;
  actorKind?: ActorKind;
  actorUserId?: string | null;

  payload?: unknown;
  supersedesCommitId?: string | null;

  authorityProof?: string;
  intentContext?: unknown;

  [k: string]: any;
};
