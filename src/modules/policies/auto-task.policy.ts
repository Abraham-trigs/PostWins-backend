import { CaseLifecycle, TaskId } from "@prisma/client";

export type TaskPolicyResult =
  | { kind: "NO_ACTION"; reason: string }
  | { kind: "ADVANCE_TASK"; to: TaskId; reason: string };

export function autoTaskAdvance(input: {
  lifecycle: CaseLifecycle;
  currentTask: TaskId;
  hasRoutingDecision: boolean;
  hasDeliveryRecorded: boolean;
}): TaskPolicyResult {
  /**
   * Rule 1:
   * After routing is authoritatively decided,
   * START → ENROLL is operationally safe.
   */
  if (
    input.lifecycle === CaseLifecycle.ROUTED &&
    input.currentTask === TaskId.START &&
    input.hasRoutingDecision
  ) {
    return {
      kind: "ADVANCE_TASK",
      to: TaskId.ENROLL,
      reason: "Case routed; enrollment may begin",
    };
  }

  /**
   * Rule 2:
   * After delivery evidence exists,
   * ENROLL → ATTEND is operationally safe.
   */
  if (
    input.lifecycle === CaseLifecycle.ROUTED &&
    input.currentTask === TaskId.ENROLL &&
    input.hasDeliveryRecorded
  ) {
    return {
      kind: "ADVANCE_TASK",
      to: TaskId.ATTEND,
      reason: "Delivery recorded",
    };
  }

  return {
    kind: "NO_ACTION",
    reason: "No deterministic task transition applicable",
  };
}
