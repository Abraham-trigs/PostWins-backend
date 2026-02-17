// apps/backend/src/modules/cases/caseLifecycle.transitions.ts
// Purpose: Canonical lifecycle transition policy derived strictly from Prisma CaseLifecycle enum.

import { CaseLifecycle } from "@prisma/client";

/**
 * Closed Transition Law:
 * If it is not declared here, it does not exist.
 *
 * Terminal states must explicitly map to [].
 * This ensures exhaustiveness and prevents silent drift.
 */
export const CASE_LIFECYCLE_TRANSITIONS: Record<
  CaseLifecycle,
  readonly CaseLifecycle[]
> = {
  [CaseLifecycle.INTAKE]: [CaseLifecycle.ROUTED],

  [CaseLifecycle.ROUTED]: [CaseLifecycle.ACCEPTED],

  [CaseLifecycle.ACCEPTED]: [CaseLifecycle.EXECUTING],

  [CaseLifecycle.EXECUTING]: [CaseLifecycle.VERIFIED, CaseLifecycle.FLAGGED],

  [CaseLifecycle.VERIFIED]: [CaseLifecycle.COMPLETED],

  [CaseLifecycle.FLAGGED]: [CaseLifecycle.HUMAN_REVIEW],

  [CaseLifecycle.HUMAN_REVIEW]: [
    CaseLifecycle.REJECTED,
    CaseLifecycle.VERIFIED,
  ],

  // Terminal states — no forward transitions

  [CaseLifecycle.COMPLETED]: [],

  [CaseLifecycle.REJECTED]: [],

  [CaseLifecycle.ARCHIVED]: [],

  [CaseLifecycle.CANCELLED]: [],
};
