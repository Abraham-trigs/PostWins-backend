import { prisma } from "../../lib/prisma";
import { CaseLifecycle, ActorKind, LedgerEventType } from "@prisma/client";

import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";

/**
 * Decision types that are allowed to move Case.lifecycle.
 *
 * NOTE:
 * - Decisions are AUTHORITATIVE
 * - Ledger records facts
 * - Lifecycle transitions are projections
 */
export type DecisionType = "ROUTING" | "VERIFICATION" | "FLAGGING" | "APPEAL";

/**
 * Explicit lifecycle outcomes per decision.
 *
 * ⚠️ This maps DECISION → TARGET LIFECYCLE
 * It does NOT encode transition validity.
 * Validity is enforced by CASE_LIFECYCLE_TRANSITIONS.
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
   * This is the ONLY place where:
   * - lifecycle transitions are triggered by intent
   * - ledger commits are causally tied to decisions
   */
  async applyDecision(params: {
    tenantId: string;
    caseId: string;

    decisionType: DecisionType;
    actorKind: ActorKind;
    actorUserId?: string;

    reason?: string;
    intentContext?: Record<string, unknown>;
  }) {
    const {
      tenantId,
      caseId,
      decisionType,
      actorKind,
      actorUserId,
      reason,
      intentContext,
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

    // 2️⃣ Persist decision record (snapshot, not authority)
    await prisma.decision.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        caseId,
        decisionType,
        actorKind,
        actorUserId,
        reason,
        decidedAt: new Date(),
        intentContext,
      },
    });

    // 3️⃣ AUTHORITATIVE lifecycle transition (with ledger cause)
    await transitionCaseLifecycleWithLedger({
      caseId,
      from,
      to,
      actorUserId,
      intentContext: {
        decisionType,
        reason,
        ...intentContext,
      },
    });
  }
}
