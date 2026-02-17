// apps/backend/src/modules/grants/tranche.service.ts

import { prisma } from "../../lib/prisma";
import { ActorKind, DecisionType, TrancheStatus } from "@prisma/client";
import { DecisionService } from "../decision/decision.service";

export class TrancheService {
  private decisionService = new DecisionService();

  /**
   * Phase 4.4 — Reverse a released tranche
   *
   * Authority is superseded.
   * Execution state is updated explicitly.
   * Lifecycle remains unchanged.
   *
   * No financial math occurs here.
   * This only marks the tranche as reversed.
   */
  async reverseTranche(params: {
    tenantId: string;
    caseId: string;
    trancheId: string;
    actorUserId: string;
    reason: string;
  }) {
    const { tenantId, caseId, trancheId, actorUserId, reason } = params;

    // 1️⃣ Ensure tranche exists and is RELEASED
    const tranche = await prisma.tranche.findFirst({
      where: { id: trancheId },
      select: { status: true },
    });

    if (!tranche) {
      throw new Error(`Tranche not found: ${trancheId}`);
    }

    if (tranche.status !== TrancheStatus.RELEASED) {
      throw new Error(
        `Tranche ${trancheId} is not RELEASED and cannot be reversed`,
      );
    }

    // 2️⃣ Locate authoritative TRANCHE decision tied to this tranche
    const priorDecision = await prisma.decision.findFirst({
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

    if (!priorDecision) {
      throw new Error(
        `No authoritative tranche decision found for ${trancheId}`,
      );
    }

    // 3️⃣ Atomic authority + execution mutation
    await prisma.$transaction(async (tx) => {
      // 3a️⃣ Supersede prior authority
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
            originalDecisionId: priorDecision.id,
          },
          supersedesDecisionId: priorDecision.id,
        },
        tx,
      );

      // 3b️⃣ Mark execution state
      await tx.tranche.update({
        where: { id: trancheId },
        data: {
          status: TrancheStatus.REVERSED,
          reversedAt: new Date(),
        },
      });

      // 3c️⃣ Execution telemetry (non-ledger)
      await tx.trancheEvent.create({
        data: {
          trancheId,
          type: "TRANCHE_REVERSED",
          payload: {
            reversedByDecisionId: priorDecision.id,
            reason,
          },
        },
      });
    });
  }

  /**
   * Phase 4.5 — Compensate a reversed tranche
   *
   * Creates a NEW tranche with negative financial effect.
   * No history is deleted.
   * Financial math reconciles explicitly.
   *
   * This maintains auditability and financial correctness.
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

    if (!reversed) {
      throw new Error(`Reversed tranche not found: ${reversedTrancheId}`);
    }

    if (!reversed.plannedAmount || !reversed.plannedPercent) {
      throw new Error(
        `Reversed tranche missing financial values: ${reversedTrancheId}`,
      );
    }

    const plannedAmount = reversed.plannedAmount;
    const plannedPercent = reversed.plannedPercent;

    // 2️⃣ Atomic compensation
    await prisma.$transaction(async (tx) => {
      // 2a️⃣ Create compensating tranche
      // Must include plannedPercent (required by schema)
      const compensatingTranche = await tx.tranche.create({
        data: {
          grantId: reversed.grantId,
          sequence: reversed.sequence + 1000, // deterministic ordering offset

          // Reverse the financial effect
          plannedAmount: plannedAmount.neg(),
          plannedPercent: plannedPercent.neg(),

          status: TrancheStatus.RELEASED,
          releasedAt: new Date(),
        },
      });

      // 2b️⃣ Record authoritative decision (new fact)
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

      // 2c️⃣ Execution telemetry (non-ledger)
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
