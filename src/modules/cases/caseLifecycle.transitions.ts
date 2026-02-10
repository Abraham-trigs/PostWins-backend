import { CaseLifecycle } from "./CaseLifecycle";

/**
 * Allowed CaseLifecycle transitions.
 *
 * This is POLICY, not implementation.
 * Keep deterministic. No side effects.
 *
 * 🧠 Invariant (Closed Transition Law):
 * If it’s not here, it does not exist.
 */
export const CASE_LIFECYCLE_TRANSITIONS: Record<
  CaseLifecycle,
  readonly CaseLifecycle[]
> = {
  INTAKE: [CaseLifecycle.ROUTED],
  ROUTED: [CaseLifecycle.ACCEPTED],
  ACCEPTED: [CaseLifecycle.EXECUTING],
  EXECUTING: [CaseLifecycle.VERIFIED, CaseLifecycle.FLAGGED],
  VERIFIED: [],
  FLAGGED: [CaseLifecycle.HUMAN_REVIEW],
  HUMAN_REVIEW: [],
};
