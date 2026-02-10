// modules/cases/CaseLifecycle.ts

/**
 * ⚠️ LIFECYCLE LAW
 * --------------------------------------------------
 * CaseLifecycle is AUTHORITATIVE STATE.
 *
 * ❌ Do NOT write lifecycle directly.
 * ❌ Do NOT infer lifecycle from routing, verification, or tasks.
 *
 * ✅ All lifecycle changes MUST go through:
 * transitionCaseLifecycleWithLedger
 */

export enum CaseLifecycle {
  INTAKE = "INTAKE",
  ROUTED = "ROUTED",
  ACCEPTED = "ACCEPTED",
  EXECUTING = "EXECUTING",
  VERIFIED = "VERIFIED",
  FLAGGED = "FLAGGED",
  HUMAN_REVIEW = "HUMAN_REVIEW",
}
