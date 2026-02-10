import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { CaseLifecycle, DecisionType, Prisma } from "@prisma/client";

import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { ApplyDecisionParams } from "./decision.types";

/**
 * Explicit lifecycle outcomes per decision.
 *
 * ⚠️ Maps DECISION → TARGET LIFECYCLE
 * - Does NOT encode transition validity
 * - Does NOT assume current lifecycle
 * - Lifecycle is a projection of authoritative intent only
 */
const DECISION_OUTCOME_LIFECYCLE: Partial<Record<DecisionType, CaseLifecycle>> =
  {
    ROUTING: CaseLifecycle.ROUTED,
    VERIFICATION: CaseLifecycle.VERIFIED,
    FLAGGING: CaseLifecycle.FLAGGED,
    APPEAL: CaseLifecycle.HUMAN_REVIEW,

    // Budget is authorization, not execution
    BUDGET: CaseLifecycle.ROUTED,
  };

export class DecisionService {
  /**
   * Apply an authoritative decision.
   *
   * Authority invariants (ENFORCED):
   * - History is never rewritten
   * - Decisions may be superseded explicitly
   * - At most ONE active decision per (caseId, decisionType)
   * - Lifecycle reflects intent, not execution
   */
  async applyDecision(
    params: ApplyDecisionParams,
    tx: Prisma.TransactionClient = prisma,
  ) {
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

    // 1️⃣ Supersede existing active decisions of this type
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

    // 2️⃣ Persist new authoritative decision
    const decision = await tx.decision.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        caseId,
        decisionType,
        actorKind,
        actorUserId,
        reason,
        intentContext,
        decidedAt: new Date(),
        supersedesDecisionId: supersedesDecisionId ?? null,
      },
    });

    // 3️⃣ Ledger-backed lifecycle projection (LAW ENFORCED ELSEWHERE)
    await transitionCaseLifecycleWithLedger({
      tenantId,
      caseId,
      target,
      actor: {
        kind: actorKind,
        userId: actorUserId,
        authorityProof: "AUTHORITATIVE_DECISION",
      },
      intentContext: {
        decisionId: decision.id,
        decisionType,
        supersedesDecisionId,
        reason,
        ...intentContext,
      },
    });
  }
}
