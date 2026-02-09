export type PolicySimulationInput = {
  tenantId: string;
  caseId: string;

  hypotheticalFacts: {
    routingDecision?: boolean;
    deliveryRecorded?: boolean;
    followupRecorded?: boolean;
  };
};

export type PolicySimulationResult = {
  policyKey: string;
  version: string;

  wouldApply: boolean;
  effect?: {
    kind: "ADVANCE_TASK" | "ROUTE" | "NO_OP";
    details: Record<string, unknown>;
  };

  reason: string;
};
