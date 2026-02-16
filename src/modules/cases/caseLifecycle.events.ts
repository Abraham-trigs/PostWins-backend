// apps/backend/src/modules/cases/caseLifecycle.events.ts
// Canonical mapping between CaseLifecycle states and LedgerEventType.
// Closed mapping — every lifecycle must map to exactly one ledger event.

import { LedgerEventType, CaseLifecycle } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Lifecycle → Ledger Event Mapping
////////////////////////////////////////////////////////////////

/**
 * LAW:
 * - Every CaseLifecycle MUST map to exactly one LedgerEventType.
 * - No fallbacks.
 * - No generic CASE_UPDATED misuse.
 * - Compiler must fail if lifecycle enum changes.
 */
export const CASE_LIFECYCLE_LEDGER_EVENTS: Record<
  CaseLifecycle,
  LedgerEventType
> = {
  [CaseLifecycle.INTAKE]: LedgerEventType.CASE_CREATED,

  [CaseLifecycle.ROUTED]: LedgerEventType.ROUTED,

  [CaseLifecycle.ACCEPTED]: LedgerEventType.CASE_ACCEPTED,

  [CaseLifecycle.EXECUTING]: LedgerEventType.EXECUTION_STARTED,

  [CaseLifecycle.VERIFIED]: LedgerEventType.VERIFIED,

  [CaseLifecycle.FLAGGED]: LedgerEventType.CASE_FLAGGED,

  [CaseLifecycle.HUMAN_REVIEW]: LedgerEventType.CASE_FLAGGED,
};
