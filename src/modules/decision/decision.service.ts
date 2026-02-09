import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { CaseLifecycle, ActorKind, DecisionType } from "@prisma/client";

import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";

/**
 * Explicit lifecycle outcomes per decision.
 *
 * ⚠️ This maps DECISION → TARGET LIFECYCLE
 * It does NOT encode transition validity.
 * Validity is enforced elsewhere.
 */
const DECISION_OUTCOME_LIFECYCLE: Record<DecisionType, CaseLifecycle> = {
  ROUTING: CaseLifecycle.ROUTED,
  VERIFICATION: CaseLifecycle.VERIFIED,
  FLAGGING: CaseLifecycle.FLAGGED,
  APPEAL: CaseLifecycle.HUMAN_REVIEW,
};

export class DecisionService {
  /**
   * Apply a decision that may move Case.lifecycle.
   *
   * Phase 4 invariant:
   * - Decisions may supersede prior decisions
   * - Superseded decisions remain true but non-authoritative
   */
  async applyDecision(params: {
    tenantId: string;
    caseId: string;

    decisionType: DecisionType;
    actorKind: ActorKind;
    actorUserId?: string;

    reason?: string;
    intentContext?: Record<string, unknown>;

    // 🔁 Phase 4 — optional supersession
    supersedesDecisionId?: string;
  }) {
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
    const existing = await prisma.case.findFirst({
      where: { id: caseId, tenantId },
      select: { lifecycle: true },
    });

    if (!existing) {
      throw new Error(`Case not found: ${caseId}`);
    }

    const from = existing.lifecycle;
    const to = DECISION_OUTCOME_LIFECYCLE[decisionType];

    if (!to) {
      throw new Error(`Unhandled DecisionType: ${decisionType}`);
    }

    await prisma.$transaction(async (tx) => {
      // 2️⃣ Explicitly supersede prior decision (if provided)
      if (supersedesDecisionId) {
        const prior = await tx.decision.findFirst({
          where: {
            id: supersedesDecisionId,
            tenantId,
            caseId,
            supersededAt: null,
          },
        });

        if (!prior) {
          throw new Error(
            `Decision ${supersedesDecisionId} cannot be superseded`,
          );
        }

        await tx.decision.update({
          where: { id: supersedesDecisionId },
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

      // 4️⃣ AUTHORITATIVE lifecycle projection (ledger-backed)
      await transitionCaseLifecycleWithLedger({
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
      });
    });
  }
}
