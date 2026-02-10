import { CaseLifecycle } from "./CaseLifecycle";
import { CASE_LIFECYCLE_TRANSITIONS } from "./caseLifecycle.transitions";
import { IllegalLifecycleTransitionError } from "./case.errors";

/**
 * Pure lifecycle transition function.
 *
 * This is LAW, not enforcement.
 * - Deterministic
 * - Side-effect free
 * - Throws on illegal transitions
 */
export function transitionCaseLifecycle(params: {
  caseId: string;
  current: CaseLifecycle;
  target: CaseLifecycle;
}): CaseLifecycle {
  const allowed = CASE_LIFECYCLE_TRANSITIONS[params.current] ?? [];

  if (!allowed.includes(params.target)) {
    throw new IllegalLifecycleTransitionError(
      params.current,
      params.target,
      params.caseId,
    );
  }

  return params.target;
}
