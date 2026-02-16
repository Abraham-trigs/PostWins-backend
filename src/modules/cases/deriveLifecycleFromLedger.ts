// apps/backend/src/modules/cases/deriveLifecycleFromLedger.ts
// Deterministic lifecycle projection from ordered ledger events.

import { CaseLifecycle, LedgerEventType } from "@prisma/client";

/**
 * LedgerEvent minimal shape required for lifecycle replay.
 */
export interface LifecycleLedgerEvent {
  eventType: LedgerEventType;
}

/**
 * Deterministically derives CaseLifecycle from ordered ledger events.
 *
 * Invariant:
 * - Input MUST be strictly ordered by ts ascending.
 * - Pure function.
 * - No database calls.
 * - Ledger is authoritative.
 *
 * Replay is literal, not inferential.
 */
export function deriveLifecycleFromLedger(
  events: LifecycleLedgerEvent[],
): CaseLifecycle {
  let lifecycle: CaseLifecycle = CaseLifecycle.INTAKE;

  for (const event of events) {
    switch (event.eventType) {
      ////////////////////////////////////////////////////////////////
      // Creation
      ////////////////////////////////////////////////////////////////

      case LedgerEventType.CASE_CREATED:
        lifecycle = CaseLifecycle.INTAKE;
        break;

      ////////////////////////////////////////////////////////////////
      // Routing
      ////////////////////////////////////////////////////////////////

      case LedgerEventType.ROUTED:
        lifecycle = CaseLifecycle.ROUTED;
        break;

      ////////////////////////////////////////////////////////////////
      // Acceptance (explicit)
      ////////////////////////////////////////////////////////////////

      case LedgerEventType.CASE_ACCEPTED:
        lifecycle = CaseLifecycle.ACCEPTED;
        break;

      ////////////////////////////////////////////////////////////////
      // Execution
      ////////////////////////////////////////////////////////////////

      case LedgerEventType.EXECUTION_STARTED:
        lifecycle = CaseLifecycle.EXECUTING;
        break;

      case LedgerEventType.EXECUTION_PROGRESS_RECORDED:
        lifecycle = CaseLifecycle.EXECUTING;
        break;

      case LedgerEventType.EXECUTION_COMPLETED:
        lifecycle = CaseLifecycle.EXECUTING;
        break;

      case LedgerEventType.EXECUTION_ABORTED:
        lifecycle = CaseLifecycle.FLAGGED;
        break;

      ////////////////////////////////////////////////////////////////
      // Verification
      ////////////////////////////////////////////////////////////////

      case LedgerEventType.VERIFIED:
        lifecycle = CaseLifecycle.VERIFIED;
        break;

      ////////////////////////////////////////////////////////////////
      // Governance
      ////////////////////////////////////////////////////////////////

      case LedgerEventType.CASE_FLAGGED:
        lifecycle = CaseLifecycle.FLAGGED;
        break;

      case LedgerEventType.LIFECYCLE_REPAIRED:
        // Repair events describe projection correction,
        // not causal lifecycle mutation.
        break;

      ////////////////////////////////////////////////////////////////
      // Non-lifecycle events
      ////////////////////////////////////////////////////////////////

      default:
        break;
    }
  }

  return lifecycle;
}
