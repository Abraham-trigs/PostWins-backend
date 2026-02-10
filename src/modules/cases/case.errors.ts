// modules/cases/case.errors.ts

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
