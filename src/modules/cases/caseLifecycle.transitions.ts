import { CaseLifecycle } from "@prisma/client";

/**
 * Allowed CaseLifecycle transitions.
 *
 * This is POLICY, not implementation.
 * Keep deterministic. No side effects.
 */
export const CASE_LIFECYCLE_TRANSITIONS: Record<
  CaseLifecycle,
  CaseLifecycle[]
> = {
  INTAKE: [CaseLifecycle.ROUTED],

  ROUTED: [CaseLifecycle.VERIFIED, CaseLifecycle.FLAGGED],

  FLAGGED: [CaseLifecycle.HUMAN_REVIEW],

  HUMAN_REVIEW: [CaseLifecycle.VERIFIED, CaseLifecycle.FLAGGED],

  VERIFIED: [],
};
