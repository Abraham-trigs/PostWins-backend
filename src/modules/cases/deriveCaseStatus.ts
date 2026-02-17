// src/modules/cases/deriveCaseStatus.ts
// Derives advisory CaseStatus from authoritative CaseLifecycle

import { CaseLifecycle, CaseStatus } from "@prisma/client";

/**
 * Derives advisory CaseStatus from authoritative CaseLifecycle.
 *
 * ⚠️ NON-AUTHORITATIVE OUTPUT
 * - UI / operational convenience only
 * - Must not encode business rules
 * - Must not branch on anything except lifecycle
 */
export function deriveCaseStatus(lifecycle: CaseLifecycle): CaseStatus {
  switch (lifecycle) {
    case CaseLifecycle.INTAKE:
      return CaseStatus.INTAKED;

    case CaseLifecycle.ROUTED:
      return CaseStatus.ROUTED;

    case CaseLifecycle.ACCEPTED:
      return CaseStatus.ACCEPTED;

    case CaseLifecycle.EXECUTING:
      return CaseStatus.EXECUTING;

    case CaseLifecycle.VERIFIED:
      return CaseStatus.VERIFIED;

    case CaseLifecycle.FLAGGED:
      return CaseStatus.FLAGGED;

    case CaseLifecycle.HUMAN_REVIEW:
      return CaseStatus.IN_REVIEW;

    case CaseLifecycle.COMPLETED:
      return CaseStatus.COMPLETED;

    case CaseLifecycle.REJECTED:
      return CaseStatus.REJECTED;

    case CaseLifecycle.CANCELLED:
      return CaseStatus.CANCELLED;

    case CaseLifecycle.ARCHIVED:
      return CaseStatus.ARCHIVED;

    default: {
      const _exhaustive: never = lifecycle;
      return _exhaustive;
    }
  }
}
