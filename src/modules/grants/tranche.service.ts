import { prisma } from "../../lib/prisma";
import { ActorKind, DecisionType, TrancheStatus } from "@prisma/client";
import { DecisionService } from "../decision/decision.service";

export class TrancheService {
  private decisionService = new DecisionService();

  async reverseTranche(params: {
    tenantId: string;
    caseId: string;
    trancheId: string;
    actorUserId: string;
    reason: string;
  }) {
    const { tenantId, caseId, trancheId, actorUserId, reason } = params;

    // 1️⃣ Assert tranche exists and is RELEASED
    const tranche = await prisma.tranche.findFirst({
      where: { id: trancheId },
      select: { status: true },
    });

    if (!tranche) {
      throw new Error(`Tranche not found: ${trancheId}`);
    }

    if (tranche.status !== TrancheStatus.RELEASED) {
      throw new Error(
        `Tranche ${trancheId} is not released and cannot be reversed`,
      );
    }

    // 2️⃣ Find authoritative decision for THIS tranche
    const priorTrancheDecision = await prisma.decision.findFirst({
      where: {
        tenantId,
        caseId,
        decisionType: DecisionType.TRANCHE,
        supersededAt: null,
        intentContext: {
          path: ["trancheId"],
          equals: trancheId,
        },
      },
      orderBy: { decidedAt: "desc" },
    });

    if (!priorTrancheDecision) {
      throw new Error(
        `No authoritative tranche decision found for tranche ${trancheId}`,
      );
    }

    // 3️⃣ Atomic authority + execution
    await prisma.$transaction(async (tx) => {
      await this.decisionService.applyDecision(
        {
          tenantId,
          caseId,
          decisionType: DecisionType.TRANCHE,
          actorKind: ActorKind.HUMAN,
          actorUserId,
          reason,
          intentContext: {
            trancheId,
            originalDecisionId: priorTrancheDecision.id,
          },
          supersedesDecisionId: priorTrancheDecision.id,
        },
        tx,
      );

      await tx.tranche.update({
        where: { id: trancheId },
        data: {
          status: TrancheStatus.REVERSED,
          reversedAt: new Date(),
        },
      });

      await tx.trancheEvent.create({
        data: {
          trancheId,
          type: "TRANCHE_REVERSED",
          payload: {
            reversedByDecisionId: priorTrancheDecision.id,
            reason,
          },
        },
      });
    });
  }
}
