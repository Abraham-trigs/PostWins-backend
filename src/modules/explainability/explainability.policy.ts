import { ExplainabilityRole } from "./explainability.types";

export const EXPLAINABILITY_POLICY: Record<
  ExplainabilityRole,
  {
    decision: {
      actorUserId: boolean;
      intentContext: boolean;
      reason: boolean;
    };
    ledger: {
      actorUserId: boolean;
      intentContext: boolean;
      payload: boolean;
      authorityProof: boolean;
      signature: boolean;
    };
    routing: {
      decidedByUserId: boolean;
      counterfactual: boolean;
    };
  }
> = {
  INTERNAL: {
    decision: {
      actorUserId: true,
      intentContext: true,
      reason: true,
    },
    ledger: {
      actorUserId: true,
      intentContext: true,
      payload: true,
      authorityProof: true,
      signature: true,
    },
    routing: {
      decidedByUserId: true,
      counterfactual: true,
    },
  },

  AUDITOR: {
    decision: {
      actorUserId: false,
      intentContext: true,
      reason: true,
    },
    ledger: {
      actorUserId: false,
      intentContext: true,
      payload: true,
      authorityProof: true,
      signature: true,
    },
    routing: {
      decidedByUserId: false,
      counterfactual: true,
    },
  },

  PARTNER: {
    decision: {
      actorUserId: false,
      intentContext: false,
      reason: true,
    },
    ledger: {
      actorUserId: false,
      intentContext: false,
      payload: false,
      authorityProof: false,
      signature: false,
    },
    routing: {
      decidedByUserId: false,
      counterfactual: false,
    },
  },

  PUBLIC: {
    decision: {
      actorUserId: false,
      intentContext: false,
      reason: true,
    },
    ledger: {
      actorUserId: false,
      intentContext: false,
      payload: false,
      authorityProof: false,
      signature: false,
    },
    routing: {
      decidedByUserId: false,
      counterfactual: false,
    },
  },
} as const;
