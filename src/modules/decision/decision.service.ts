import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { CaseLifecycle, ActorKind, DecisionType } from "@prisma/client";

import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";

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

    // NOTE:
    // TRANCHE intentionally excluded.
    // Tranche effects are handled in Phase 4.4 (explicit reversal),
    // not via lifecycle projection.
  };

export class DecisionService {
  /**
   * Apply an authoritative decision.
   *
   * Phase 4 invariants:
   * - History is never rewritten
   * - Decisions may be superseded explicitly
   * - Only the latest non-superseded decision of a type is authoritative
   * - Lifecycle reflects authoritative intent, not execution state
   */
  async applyDecision(params: {
    tenantId: string;
    caseId: string;

    decisionType: DecisionType;
    actorKind: ActorKind;
    actorUserId?: string;

    reason?: string;
    intentContext?: Record<string, unknown>;

    // 🔁 Phase 4 — explicit supersession
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
      throw new Error(
        `DecisionType ${decisionType} does not project lifecycle`,
      );
    }

    await prisma.$transaction(async (tx) => {
      // 2️⃣ Explicit supersession (same-type only)
      if (supersedesDecisionId) {
        const prior = await tx.decision.findFirst({
          where: {
            id: supersedesDecisionId,
            tenantId,
            caseId,
            decisionType,
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

      // 4️⃣ Lifecycle projection (ledger-backed, append-only)
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
