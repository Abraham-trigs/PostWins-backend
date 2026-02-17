// src/modules/decision/decision.service.ts
// Purpose: Authoritative decision application with ledger-backed lifecycle projection.

import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { CaseLifecycle, DecisionType, Prisma, ActorKind } from "@prisma/client";

import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { ApplyDecisionParams } from "./decision.types";

////////////////////////////////////////////////////////////////
// Lifecycle Projection Map
////////////////////////////////////////////////////////////////

const DECISION_OUTCOME_LIFECYCLE: Partial<Record<DecisionType, CaseLifecycle>> =
  {
    ROUTING: CaseLifecycle.ROUTED,
    VERIFICATION: CaseLifecycle.VERIFIED,
    FLAGGING: CaseLifecycle.FLAGGED,
    APPEAL: CaseLifecycle.HUMAN_REVIEW,
    BUDGET: CaseLifecycle.ROUTED,
  };

////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////

function buildIntentEnvelope(
  decisionId: string,
  decisionType: DecisionType,
  supersedesDecisionId: string | undefined,
  reason: string | undefined,
  intentContext: unknown,
): Prisma.InputJsonValue {
  const base: Record<string, unknown> = {
    decisionId,
    decisionType,
    supersedesDecisionId: supersedesDecisionId ?? null,
    reason: reason ?? null,
  };

  if (
    intentContext &&
    typeof intentContext === "object" &&
    !Array.isArray(intentContext)
  ) {
    Object.assign(base, intentContext as Record<string, unknown>);
  }

  return base as Prisma.InputJsonValue;
}

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class DecisionService {
  /**
   * Apply an authoritative decision.
   *
   * Invariants:
   * - Immutable history
   * - Explicit supersession
   * - Single active decision per (caseId, decisionType)
   * - Lifecycle reflects authoritative intent only
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
    } = params;

    const target = DECISION_OUTCOME_LIFECYCLE[decisionType];

    if (!target) {
      throw new Error(
        `DecisionType ${decisionType} does not project lifecycle`,
      );
    }

    ////////////////////////////////////////////////////////////////
    // 1️⃣ Supersede existing active decisions
    ////////////////////////////////////////////////////////////////

    const activeDecisions = await tx.decision.findMany({
      where: {
        tenantId,
        caseId,
        decisionType,
        supersededAt: null,
      },
    });

    for (const prior of activeDecisions) {
      if (supersedesDecisionId && prior.id !== supersedesDecisionId) {
        throw new Error(
          `Explicit supersession mismatch: expected ${supersedesDecisionId}, found ${prior.id}`,
        );
      }

      await tx.decision.update({
        where: { id: prior.id },
        data: { supersededAt: new Date() },
      });
    }

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Persist authoritative decision
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
    // 3️⃣ Ledger-backed lifecycle projection
    ////////////////////////////////////////////////////////////////

    await transitionCaseLifecycleWithLedger({
      tenantId,
      caseId,
      target,
      actor: {
        kind: actorKind,
        userId: actorUserId ?? null,
        authorityProof: "AUTHORITATIVE_DECISION",
      },
      intentContext: buildIntentEnvelope(
        decision.id,
        decisionType,
        supersedesDecisionId,
        reason,
        intentContext,
      ),
    });
  }
}
