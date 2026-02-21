// src/modules/decision/decision.service.ts
// Authoritative decision persistence.
// Lifecycle mutation delegated to Orchestrator.
// No static lifecycle projection map.

import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { DecisionType, Prisma, ActorKind } from "@prisma/client";

import { DecisionOrchestrationService } from "./decision-orchestration.service";
import { ApplyDecisionParams } from "./decision.types";

export class DecisionService {
  constructor(private orchestrator: DecisionOrchestrationService) {}

  /**
   * Apply authoritative decision.
   *
   * Guarantees:
   * - Immutable decision history
   * - Explicit supersession
   * - Single active decision per (caseId, decisionType)
   * - Effect execution delegated
   */
  async applyDecision(
    params: ApplyDecisionParams,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const {
      tenantId,
      caseId,
      decisionType,
      actorKind,
      actorUserId,
      reason,
      intentContext,
      supersedesDecisionId,
      effect,
    } = params;

    ////////////////////////////////////////////////////////////////
    // 1️⃣ Supersede active decisions
    ////////////////////////////////////////////////////////////////

    const active = await tx.decision.findMany({
      where: {
        tenantId,
        caseId,
        decisionType,
        supersededAt: null,
      },
    });

    for (const prior of active) {
      if (supersedesDecisionId && prior.id !== supersedesDecisionId) {
        throw new Error(
          `Supersession mismatch: expected ${supersedesDecisionId}, found ${prior.id}`,
        );
      }

      await tx.decision.update({
        where: { id: prior.id },
        data: { supersededAt: new Date() },
      });
    }

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Persist decision
    ////////////////////////////////////////////////////////////////

    const decision = await tx.decision.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        caseId,
        decisionType,
        actorKind,
        actorUserId: actorKind === ActorKind.HUMAN ? actorUserId : null,
        reason,
        intentContext: intentContext as Prisma.InputJsonValue | undefined,
        decidedAt: new Date(),
        supersedesDecisionId: supersedesDecisionId ?? null,
      },
    });

    ////////////////////////////////////////////////////////////////
    // 3️⃣ Execute effect via Orchestrator
    ////////////////////////////////////////////////////////////////

    await this.orchestrator.executeDecisionEffect(
      {
        tenantId,
        caseId,
        decisionId: decision.id,
        effect,
        actorKind,
        actorUserId,
      },
      tx,
    );
  }
}
