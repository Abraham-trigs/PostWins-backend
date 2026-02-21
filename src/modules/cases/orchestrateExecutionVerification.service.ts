// apps/backend/src/modules/orchestrator/orchestrator.service.ts

import { Prisma, ActorKind, ExecutionStatus } from "@prisma/client";
import { CaseLifecycle } from "../cases/CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { InvariantViolationError } from "../cases/case.errors";
import { DecisionEffect } from "../decision/decision.types";

type ExecuteEffectParams = {
  tenantId: string;
  caseId: string;
  decisionId: string;
  effect: DecisionEffect;
};

type OrchestratorActor = {
  kind: ActorKind;
  userId?: string;
  authorityProof: string;
};

export class OrchestratorService {
  async executeEffect(
    params: ExecuteEffectParams,
    actor: OrchestratorActor,
    tx: Prisma.TransactionClient,
  ) {
    const { tenantId, caseId, decisionId, effect } = params;

    switch (effect.kind) {
      case "EXECUTION_VERIFIED":
        return this.handleExecutionVerified(
          tenantId,
          caseId,
          decisionId,
          actor,
          tx,
        );

      default:
        throw new Error(`Unsupported effect kind: ${effect.kind}`);
    }
  }

  ////////////////////////////////////////////////////////////////
  // EXECUTION_VERIFIED
  ////////////////////////////////////////////////////////////////

  private async handleExecutionVerified(
    tenantId: string,
    caseId: string,
    decisionId: string,
    actor: OrchestratorActor,
    tx: Prisma.TransactionClient,
  ) {
    const c = await tx.case.findFirst({
      where: { id: caseId, tenantId },
      select: { lifecycle: true },
    });

    if (!c) {
      throw new InvariantViolationError("CASE_NOT_FOUND");
    }

    if (c.lifecycle !== CaseLifecycle.EXECUTING) {
      throw new InvariantViolationError("CASE_NOT_IN_EXECUTING_STATE");
    }

    const execution = await tx.execution.findFirst({
      where: { caseId, tenantId },
      select: { status: true },
    });

    if (!execution || execution.status !== ExecutionStatus.COMPLETED) {
      throw new InvariantViolationError("EXECUTION_NOT_COMPLETED");
    }

    const verified = await tx.verificationRecord.findFirst({
      where: {
        caseId,
        tenantId,
        consensusReached: true,
      },
      select: { id: true },
    });

    if (!verified) {
      throw new InvariantViolationError("VERIFICATION_NOT_FINALIZED");
    }

    return transitionCaseLifecycleWithLedger({
      tenantId,
      caseId,
      target: CaseLifecycle.VERIFIED,
      actor,
      intentContext: {
        decisionId,
        verificationRecordId: verified.id,
      },
    });
  }
}
