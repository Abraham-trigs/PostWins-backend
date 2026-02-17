// src/modules/explainability/redactDisbursementExplanation.ts
// Domain-level disbursement explainability + role-based redaction.

import { ExplainabilityRole } from "./explainability.types";

////////////////////////////////////////////////////////////////
// Domain DTO (NOT transport)
////////////////////////////////////////////////////////////////

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

  // Domain-level time (Date)
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

////////////////////////////////////////////////////////////////
// Redaction
////////////////////////////////////////////////////////////////

export function redactDisbursementExplanation(
  explanation: DisbursementExplanation,
  role: ExplainabilityRole,
): DisbursementExplanation {
  switch (role) {
    case "INTERNAL":
    case "AUDITOR":
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

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// This file is DOMAIN-level explainability.
// Dates remain Date objects here.
// Serialization (Date → ISO string) belongs in the mapper layer.
// Redaction must not perform transport transformations.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Strong domain DTO
// - Role-based structural redaction
// - No mutation
// - No serialization logic

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Always call this BEFORE mapping to transport response.
// Do NOT convert Date → string here.
// Keep redaction pure and deterministic.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// If additional visibility tiers are introduced,
// extend switch without leaking transport concerns.
// Domain boundary remains stable.
