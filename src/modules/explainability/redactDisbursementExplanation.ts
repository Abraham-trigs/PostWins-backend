import { ExplainabilityRole } from "./explainability.types";

export type DisbursementExplanation = {
  id: string;
  caseId: string;

  status: string;
  type: string;

  summary: string;

  amount: {
    value: string;
    currency: string;
  };

  payee?: {
    kind: string;
    id: string;
  };

  authority?: {
    proof: string;
  };

  timeline: {
    authorizedAt: Date;
    executedAt: Date | null;
    failedAt: Date | null;
  };

  failure?: {
    reason: string;
  } | null;

  explainability: {
    whyExecuted: string | null;
    whyNotExecuted: string[];
    irreversibility: string | null;
  };
};

export function redactDisbursementExplanation(
  explanation: DisbursementExplanation,
  role: ExplainabilityRole,
): DisbursementExplanation {
  switch (role) {
    case "INTERNAL":
    case "AUDITOR":
      // Full visibility
      return explanation;

    case "PARTNER":
      return {
        ...explanation,
        payee: undefined,
        authority: undefined,
        failure: undefined,
      };

    case "PUBLIC":
      return {
        id: explanation.id,
        caseId: explanation.caseId,
        status: explanation.status,
        type: explanation.type,
        summary: explanation.summary,
        amount: explanation.amount,
        timeline: explanation.timeline,
        explainability: {
          whyExecuted: explanation.explainability.whyExecuted,
          whyNotExecuted: explanation.explainability.whyNotExecuted,
          irreversibility: explanation.explainability.irreversibility,
        },
      };
  }
}
