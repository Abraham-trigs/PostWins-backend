import { prisma } from "../../lib/prisma";
import { ActorKind, DecisionType, TrancheStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { DecisionService } from "../decision/decision.service";

export class TrancheService {
  private decisionService = new DecisionService();

  /**
   * Phase 4.4 — Reverse a released tranche
   *
   * Authority is superseded.
   * Execution state is updated explicitly.
   * Lifecycle remains unchanged.
   */
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

    // 2️⃣ Find authoritative TRANCHE decision for THIS tranche
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
      // 3a️⃣ Superseding decision (authority)
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

      // 3b️⃣ Execution state
      await tx.tranche.update({
        where: { id: trancheId },
        data: {
          status: TrancheStatus.REVERSED,
          reversedAt: new Date(),
        },
      });

      // 3c️⃣ Execution telemetry (not ledger)
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

  /**
   * Phase 4.5 — Compensate a reversed tranche
   *
   * Creates a NEW tranche with negative effect.
   * No history is denied. Math reconciles explicitly.
   */
  async compensateReversedTranche(params: {
    tenantId: string;
    caseId: string;
    reversedTrancheId: string;
    actorUserId: string;
    reason: string;
  }) {
    const { tenantId, caseId, reversedTrancheId, actorUserId, reason } = params;

    // 1️⃣ Load reversed tranche
    const reversed = await prisma.tranche.findFirst({
      where: {
        id: reversedTrancheId,
        status: TrancheStatus.REVERSED,
      },
    });

    if (!reversed || !reversed.plannedAmount) {
      throw new Error(
        `Reversed tranche not found or invalid: ${reversedTrancheId}`,
      );
    }

    // 2️⃣ Atomic compensation (execution + authority)
    await prisma.$transaction(async (tx) => {
      // 2a️⃣ Create compensating tranche (negative amount)
      const compensatingTranche = await tx.tranche.create({
        data: {
          grantId: reversed.grantId,
          sequence: reversed.sequence + 1000, // deterministic ordering
          plannedAmount: new Decimal(reversed.plannedAmount).neg(),
          status: TrancheStatus.RELEASED,
          releasedAt: new Date(),
        },
      });

      // 2b️⃣ Authoritative TRANCHE decision (new fact)
      await this.decisionService.applyDecision(
        {
          tenantId,
          caseId,
          decisionType: DecisionType.TRANCHE,
          actorKind: ActorKind.HUMAN,
          actorUserId,
          reason,
          intentContext: {
            compensatesTrancheId: reversedTrancheId,
            compensatingTrancheId: compensatingTranche.id,
          },
        },
        tx,
      );

      // 2c️⃣ Execution telemetry
      await tx.trancheEvent.create({
        data: {
          trancheId: compensatingTranche.id,
          type: "TRANCHE_COMPENSATION",
          payload: {
            reversedTrancheId,
            reason,
          },
        },
      });
    });
  }
}
