// src/modules/cases/case.errors.ts
// Canonical error surface for Case domain (backward-compatible during migration)

export class IllegalLifecycleTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly caseId: string,
  ) {
    super(`Illegal lifecycle transition ${from} → ${to} for case ${caseId}`);
    this.name = "IllegalLifecycleTransitionError";
  }
}

export class LifecycleInvariantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleInvariantViolationError";
  }
}

/**
 * Backward-compatibility layer
 * ---------------------------------------------------------
 * These were previously exported and are still referenced
 * across the codebase. We alias or reintroduce them here
 * to stop drift while the migration completes.
 */

export class InvariantViolationError extends LifecycleInvariantViolationError {
  constructor(message: string) {
    super(message);
    this.name = "InvariantViolationError";
  }
}

export class CaseNotFoundError extends Error {
  constructor(public readonly caseId: string) {
    super(`Case ${caseId} not found`);
    this.name = "CaseNotFoundError";
  }
}

export class CaseForbiddenError extends Error {
  constructor(public readonly caseId: string) {
    super(`Access to case ${caseId} is forbidden`);
    this.name = "CaseForbiddenError";
  }
}

export class ResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolverError";
  }
}

/**
 * Historical alias preserved to prevent breaking older modules.
 * Previously: IllegalLifecycleInvariantViolation
 */
export class IllegalLifecycleInvariantViolation extends LifecycleInvariantViolationError {
  constructor(message: string) {
    super(message);
    this.name = "IllegalLifecycleInvariantViolation";
  }
}
