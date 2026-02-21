// src/modules/orchestrator/orchestrator.service.ts

import { prisma } from "@/lib/prisma";
import { transitionCaseLifecycleWithLedger } from "@/modules/cases/transitionCaseLifecycleWithLedger";
import { Prisma, ActorKind, CaseLifecycle } from "@prisma/client";

type ExecuteEffectParams = {
  tenantId: string;
  caseId: string;
  decisionId: string;
  effect: {
    kind: "EXECUTION_VERIFIED";
  };
};

type ActorContext = {
  kind: ActorKind;
  userId?: string;
  authorityProof: string;
};
export class OrchestratorService {
  async executeEffect(
    params: ExecuteEffectParams,
    actor: ActorContext,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const { tenantId, caseId, decisionId, effect } = params;

    switch (effect.kind) {
      case "EXECUTION_VERIFIED": {
        await transitionCaseLifecycleWithLedger(
          {
            tenantId,
            caseId,
            target: CaseLifecycle.VERIFIED,
            actor,
          },
          tx,
        );
        return;
      }
      default:
        throw new Error(`Unsupported effect: ${effect.kind}`);
    }
  }
}
