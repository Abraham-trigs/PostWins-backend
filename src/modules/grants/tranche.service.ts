// apps/backend/src/modules/grants/tranche.service.ts
// Purpose: Authoritative tranche reversal & compensation with immutable decision recording and explicit execution mutation.

import { prisma } from "../../lib/prisma";
import { ActorKind, DecisionType, TrancheStatus } from "@prisma/client";
import { DecisionService } from "../decision/decision.service";

/**
 * Design reasoning:
 * - Tranche mutations must never delete history.
 * - Authority changes are captured via DecisionService.
 * - Execution state mutation (status) is explicit and separate from authority.
 * - All operations are transactional for integrity.
 *
 * Structure:
 * - Constructor injection of DecisionService (DI-compliant).
 * - reverseTranche(): supersedes prior authority and marks tranche reversed.
 * - compensateReversedTranche(): creates financial compensation tranche + new authority fact.
 *
 * Implementation guidance:
 * - Instantiate TrancheService with a pre-wired DecisionService.
 * - Always call inside application service layer, not controllers directly.
 * - Never bypass DecisionService for authoritative actions.
 *
 * Scalability insight:
 * - Effect kind is currently static ("EXECUTION_VERIFIED").
 * - Future domain evolution should expand DecisionEffect union instead of duplicating service logic.
 */
export class TrancheService {
  constructor(private decisionService: DecisionService) {}

  /**
   * Reverse a released tranche.
   */
  async reverseTranche(params: {
    tenantId: string;
    caseId: string;
    trancheId: string;
    actorUserId: string;
    reason: string;
  }) {
    const { tenantId, caseId, trancheId, actorUserId, reason } = params;

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
            originalDecisionId: priorDecision.id,
          },
          supersedesDecisionId: priorDecision.id,
          effect: {
            kind: "EXECUTION_VERIFIED",
          },
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
            reversedByDecisionId: priorDecision.id,
            reason,
          },
        },
      });
    });
  }

  /**
   * Compensate a reversed tranche.
   */
  async compensateReversedTranche(params: {
    tenantId: string;
    caseId: string;
    reversedTrancheId: string;
    actorUserId: string;
    reason: string;
  }) {
    const { tenantId, caseId, reversedTrancheId, actorUserId, reason } = params;

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

    await prisma.$transaction(async (tx) => {
      const compensatingTranche = await tx.tranche.create({
        data: {
          grantId: reversed.grantId,
          sequence: reversed.sequence + 1000,
          plannedAmount: plannedAmount.neg(),
          plannedPercent: plannedPercent.neg(),
          status: TrancheStatus.RELEASED,
          releasedAt: new Date(),
        },
      });

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
          effect: {
            kind: "EXECUTION_VERIFIED",
          },
        },
        tx,
      );

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

/**
 * Example wiring (server layer):
 *
 * const orchestrator = new DecisionOrchestrationService(...);
 * const decisionService = new DecisionService(orchestrator);
 * const trancheService = new TrancheService(decisionService);
 */
