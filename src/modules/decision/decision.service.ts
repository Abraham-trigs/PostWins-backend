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
 * - Does NOT imply execution or reversal
 * - Lifecycle is a projection of authoritative intent only
 */
const DECISION_OUTCOME_LIFECYCLE: Partial<Record<DecisionType, CaseLifecycle>> =
  {
    ROUTING: CaseLifecycle.ROUTED,
    VERIFICATION: CaseLifecycle.VERIFIED,
    FLAGGING: CaseLifecycle.FLAGGED,
    APPEAL: CaseLifecycle.HUMAN_REVIEW,

    // Phase 4.3 — Budget is authorization, not execution
    BUDGET: CaseLifecycle.ROUTED,
  };

export class DecisionService {
  /**
   * Apply an authoritative decision.
   *
   * Authority invariants (ENFORCED):
   * - History is never rewritten
   * - Decisions may be superseded explicitly or implicitly
   * - At most ONE non-superseded decision per (caseId, decisionType)
   * - Lifecycle reflects authoritative intent, not execution state
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

    // 1️⃣ Load authoritative current lifecycle
    const existingCase = await tx.case.findFirst({
      where: { id: caseId, tenantId },
      select: { lifecycle: true },
    });

    if (!existingCase) {
      throw new Error(`Case not found: ${caseId}`);
    }

    const from = existingCase.lifecycle;
    const to = DECISION_OUTCOME_LIFECYCLE[decisionType];

    if (!to) {
      throw new Error(
        `DecisionType ${decisionType} does not project lifecycle`,
      );
    }

    // 2️⃣ Enforce single authoritative decision per type
    // Supersede ALL existing non-superseded decisions of this type
    // (explicit supersedesDecisionId is validated but not required)
    const activeDecisions = await tx.decision.findMany({
      where: {
        tenantId,
        caseId,
        decisionType,
        supersededAt: null,
      },
    });

    for (const prior of activeDecisions) {
      // If explicit supersession was provided, ensure it matches
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

    // 3️⃣ Persist new authoritative decision
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

    // 4️⃣ Ledger-backed lifecycle projection
    await transitionCaseLifecycleWithLedger(
      {
        caseId,
        from,
        to,
        actorUserId,
        intentContext: {
          decisionId: decision.id,
          decisionType,
          supersedesDecisionId,
          reason,
          ...intentContext,
        },
      },
      tx,
    );
  }
}
