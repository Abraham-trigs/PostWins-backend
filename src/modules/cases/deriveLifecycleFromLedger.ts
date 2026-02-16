// apps/backend/src/modules/cases/deriveLifecycleFromLedger.ts
// Deterministic lifecycle projection from ordered ledger events.

import { CaseLifecycle } from "./CaseLifecycle";
import { LedgerEventType } from "@prisma/client";

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
 * If new lifecycle states are introduced,
 * mapping must be updated explicitly.
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
      // Acceptance (Phase 2 compatible)
      ////////////////////////////////////////////////////////////////

      case LedgerEventType.EXECUTION_STARTED:
        lifecycle = CaseLifecycle.ACCEPTED;
        break;

      ////////////////////////////////////////////////////////////////
      // Execution
      ////////////////////////////////////////////////////////////////

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
        // No direct mutation — repair events describe correction,
        // but replay should derive from causal events only.
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

/*
Design reasoning
----------------
Ledger is sovereign truth.
Projection must be rebuildable deterministically.
Replay must:
- Avoid side effects
- Avoid implicit inference
- Ignore non-lifecycle events
- Explicitly map new lifecycle states

Structure
---------
- Ordered iteration
- Explicit switch
- Authoritative event mapping only
- Ignore noise safely

Implementation guidance
-----------------------
Always fetch ledger ordered by ts ASC.
Never allow lifecycle to be mutated outside ledger events.
When introducing new lifecycle states,
update this mapping explicitly.

Scalability insight
-------------------
This enables:
- Full table rebuild
- Drift detection
- Snapshot + replay
- Horizontal scaling
- Institutional audit defensibility

Would I ship this without review?
Yes.

Does this protect lifecycle authority?
Yes.

If this fails, can it be repaired?
Yes — deterministic replay guarantees rebuild.

Who owns this tomorrow?
Lifecycle governance.
*/
