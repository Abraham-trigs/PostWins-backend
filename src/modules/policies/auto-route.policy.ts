// apps/backend/src/modules/policies/auto-route.policy.ts
import { DecisionType, CaseLifecycle } from "@prisma/client";

export type PolicyResult =
  | { kind: "NO_ACTION"; reason: string }
  | {
      kind: "PROPOSE_DECISION";
      decisionType: DecisionType;
      reason: string;
    };

export function autoRouteBasic(input: {
  lifecycle: CaseLifecycle;
  hasRoutingDecision: boolean;
  executionBodiesAvailable: number;
}): PolicyResult {
  if (input.lifecycle !== CaseLifecycle.INTAKE) {
    return { kind: "NO_ACTION", reason: "Case not in INTAKE" };
  }

  if (input.hasRoutingDecision) {
    return { kind: "NO_ACTION", reason: "Already routed" };
  }

  if (input.executionBodiesAvailable !== 1) {
    return {
      kind: "NO_ACTION",
      reason: "Ambiguous or no execution body",
    };
  }

  return {
    kind: "PROPOSE_DECISION",
    decisionType: DecisionType.ROUTING,
    reason: "Single execution body available",
  };
}
