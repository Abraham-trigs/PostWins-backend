import { prisma } from "../..//lib/prisma";
import { CaseLifecycle, ActorKind } from "@prisma/client";
import { transitionCaseLifecycle } from "./transitionCaseLifecycle";
import { CASE_LIFECYCLE_LEDGER_EVENTS } from "./caseLifecycle.events";

/**
 * NOTE:
 * This is the preferred path for meaningful lifecycle transitions.
 *
 * - A LedgerCommit is written first (CAUSE)
 * - Case.lifecycle is updated as a projection (EFFECT)
 *
 * Do not bypass this helper for decision-driven changes.
 */

export async function transitionCaseLifecycleWithLedger(params: {
  caseId: string;
  from: CaseLifecycle;
  to: CaseLifecycle;
  actorUserId?: string;
  intentContext?: Record<string, unknown>;
}) {
  const { caseId, from, to, actorUserId, intentContext } = params;

  const eventType = CASE_LIFECYCLE_LEDGER_EVENTS[to];

  return prisma.$transaction(async (tx) => {
    // 1. Write ledger commit (CAUSE)
    await tx.ledgerCommit.create({
      data: {
        caseId,
        eventType,
        ts: BigInt(Date.now()),
        actorKind: actorUserId ? ActorKind.HUMAN : ActorKind.SYSTEM,
        actorUserId,
        authorityProof: "CASE_LIFECYCLE_TRANSITION",
        intentContext,
        payload: {
          from,
          to,
        },
        commitmentHash: "placeholder", // you already have infra for this
      },
    });

    // 2. Apply projection (EFFECT)
    return transitionCaseLifecycle({
      caseId,
      from,
      to,
      actorUserId,
    });
  });
}
