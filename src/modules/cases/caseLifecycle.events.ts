// apps/backend/src/modules/cases/caseLifecycle.events.ts
// Purpose: Canonical mapping between CaseLifecycle states and LedgerEventType.
// Closed mapping — if a lifecycle exists, it MUST map to exactly one ledger event.

import { LedgerEventType, CaseLifecycle } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Lifecycle → Ledger Event Mapping
////////////////////////////////////////////////////////////////

/**
 * LAW:
 * - Every CaseLifecycle state MUST map to exactly one LedgerEventType.
 * - No fallbacks.
 * - No generic CASE_UPDATED misuse except where explicitly intentional.
 */
export const CASE_LIFECYCLE_LEDGER_EVENTS: Record<
  CaseLifecycle,
  LedgerEventType
> = {
  [CaseLifecycle.INTAKE]: LedgerEventType.CASE_CREATED,

  [CaseLifecycle.ROUTED]: LedgerEventType.ROUTED,

  [CaseLifecycle.ACCEPTED]: LedgerEventType.CASE_UPDATED,
  // Replace with CASE_ACCEPTED if you introduce a dedicated event later.

  [CaseLifecycle.EXECUTING]: LedgerEventType.EXECUTION_STARTED,

  [CaseLifecycle.VERIFIED]: LedgerEventType.VERIFIED,

  [CaseLifecycle.FLAGGED]: LedgerEventType.CASE_FLAGGED,

  [CaseLifecycle.HUMAN_REVIEW]: LedgerEventType.CASE_UPDATED,
  // Replace with CASE_ESCALATED if you introduce a dedicated event.
};

// ////////////////////////////////////////////////////////////////
// // Example Usage
// ////////////////////////////////////////////////////////////////

// /*
// const event = CASE_LIFECYCLE_LEDGER_EVENTS[CaseLifecycle.ROUTED];
// // -> LedgerEventType.ROUTED
// */

// ////////////////////////////////////////////////////////////////
// // Design reasoning
// ////////////////////////////////////////////////////////////////
// Lifecycle states represent authoritative governance transitions.
// Each state must correspond to one explicit ledger event.
// No lifecycle may exist without a mapped ledger event.
// This guarantees deterministic replay.

// ////////////////////////////////////////////////////////////////
// // Structure
// ////////////////////////////////////////////////////////////////
// - Record keyed by Prisma CaseLifecycle
// - Values strictly Prisma LedgerEventType
// - No string literals
// - No optional fallback

// ////////////////////////////////////////////////////////////////
// // Implementation guidance
// ////////////////////////////////////////////////////////////////
// If you add a new CaseLifecycle state in Prisma,
// TypeScript will fail compilation until you add it here.
// That is intentional.

// ////////////////////////////////////////////////////////////////
// // Scalability insight
// ////////////////////////////////////////////////////////////////
// When Phase 2 introduces richer event types (e.g. CASE_ACCEPTED),
// replace generic CASE_UPDATED with specific event types.
// The mapping remains stable and compiler-enforced.
