// src/modules/decision/decision-orchestration.service.ts
// Purpose: Bridges authoritative decisions to orchestrated effects.
// Keeps lifecycle mutation inside Orchestrator only.

import { Prisma, ActorKind } from "@prisma/client";
import { OrchestratorService } from "../orchestrator/orchestrator.service";
import { prisma } from "@/lib/prisma";

type ExecuteDecisionParams = {
  tenantId: string;
  caseId: string;
  decisionId: string;
  effect: {
    kind: "EXECUTION_VERIFIED";
  };
  actorKind: ActorKind;
  actorUserId?: string;
};

export class DecisionOrchestrationService {
  constructor(private orchestrator: OrchestratorService) {}

  async executeDecisionEffect(
    params: ExecuteDecisionParams,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const { tenantId, caseId, decisionId, effect, actorKind, actorUserId } =
      params;

    return this.orchestrator.executeEffect(
      {
        tenantId,
        caseId,
        decisionId,
        effect,
      },

      {
        kind: actorKind,
        userId: actorUserId,
        authorityProof: "AUTHORITATIVE_DECISION",
      },
      tx,
    );
  }
}
