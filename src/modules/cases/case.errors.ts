// src/modules/cases/case.errors.ts
// Canonical error surface for Case domain (backward-compatible during migration)

import { DomainError } from "@/lib/errors/domain-error";

export class IllegalLifecycleTransitionError extends DomainError {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly caseId: string,
  ) {
    super(
      `Illegal lifecycle transition ${from} → ${to} for case ${caseId}`,
      409,
      "ILLEGAL_LIFECYCLE_TRANSITION",
    );
    this.name = "IllegalLifecycleTransitionError";
  }
}

export class LifecycleInvariantViolationError extends DomainError {
  constructor(message: string) {
    super(message, 409, "LIFECYCLE_INVARIANT_VIOLATION");
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

export class CaseNotFoundError extends DomainError {
  constructor(public readonly caseId: string) {
    super(`Case ${caseId} not found`, 404, "CASE_NOT_FOUND");
    this.name = "CaseNotFoundError";
  }
}

export class CaseForbiddenError extends DomainError {
  constructor(public readonly caseId: string) {
    super(`Access to case ${caseId} is forbidden`, 403, "CASE_FORBIDDEN");
    this.name = "CaseForbiddenError";
  }
}

export class ResolverError extends DomainError {
  constructor(message: string) {
    super(message, 400, "RESOLVER_ERROR");
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
