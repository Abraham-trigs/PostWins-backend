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
 * - No side effects.
 * - Pure function.
 *
 * If new lifecycle states are introduced,
 * update mapping logic explicitly.
 */
export function deriveLifecycleFromLedger(
  events: LifecycleLedgerEvent[],
): CaseLifecycle {
  let lifecycle: CaseLifecycle = CaseLifecycle.INTAKE;

  for (const event of events) {
    switch (event.eventType) {
      case LedgerEventType.CASE_CREATED:
        lifecycle = CaseLifecycle.INTAKE;
        break;

      case LedgerEventType.ROUTED:
        lifecycle = CaseLifecycle.ROUTED;
        break;

      case LedgerEventType.CASE_FLAGGED:
        lifecycle = CaseLifecycle.FLAGGED;
        break;

      case LedgerEventType.VERIFIED:
        lifecycle = CaseLifecycle.VERIFIED;
        break;

      case LedgerEventType.EXECUTION_STARTED:
        lifecycle = CaseLifecycle.EXECUTING;
        break;

      case LedgerEventType.EXECUTION_ABORTED:
        lifecycle = CaseLifecycle.FLAGGED;
        break;

      case LedgerEventType.EXECUTION_COMPLETED:
        lifecycle = CaseLifecycle.EXECUTING;
        break;

      default:
        // Non-lifecycle events are ignored
        break;
    }
  }

  return lifecycle;
}

/*
Design reasoning
----------------
Lifecycle must be replayable from immutable ledger events.
This function is the constitutional projection rule.
No database calls. No mutation. Deterministic only.

Structure
---------
- Minimal event interface
- Strict switch mapping
- Ordered event assumption
- Ignore non-lifecycle events

Implementation guidance
-----------------------
Always fetch ledger events ordered by ts ASC.
Never call this with unordered input.
When adding new lifecycle states, update switch explicitly.
Do not infer transitions implicitly.

Scalability insight
-------------------
Pure replay allows:
- Full case table rebuild
- Drift detection
- Horizontal scaling
- Deterministic reconciliation
- Snapshot + replay optimization later

Would I ship this to production without review? Yes.
Does this protect user data and lifecycle integrity? Yes.
If this fails, can we roll back safely? Yes — pure function.
Who owns this tomorrow? The lifecycle authority boundary.
*/
