// modules/cases/transitionCaseLifecycleWithLedger.ts

import { prisma } from "@/lib/prisma";
import { CaseLifecycle, LedgerEventType } from "@prisma/client";
import { transitionCaseLifecycle } from "./transitionCaseLifecycle";
import { commitLedgerEvent } from "../routing/commitRoutingLedger";

/**
 * NOTE:
 * This is the preferred path for meaningful lifecycle transitions.
 *
 * - Domain rules are applied first (may throw)
 * - Ledger event is committed as the CAUSE
 * - Case.lifecycle is updated as a projection (EFFECT)
 *
 * Do not bypass this helper for decision-driven changes.
 */
export async function transitionCaseLifecycleWithLedger(params: {
  tenantId: string;
  caseId: string;
  target: CaseLifecycle;
  actor: {
    kind: "HUMAN" | "SYSTEM";
    userId?: string;
    authorityProof: string;
  };
  intentContext?: unknown;
}) {
  const { tenantId, caseId, target, actor, intentContext } = params;

  return prisma.$transaction(async (tx) => {
    // 1. Load current authoritative state
    const currentCase = await tx.case.findUniqueOrThrow({
      where: { id: caseId },
      select: { lifecycle: true },
    });

    // 2. Apply pure domain rules (may throw domain errors)
    const nextLifecycle = transitionCaseLifecycle({
      caseId,
      current: currentCase.lifecycle,
      target,
    });

    // 3. EFFECT — update projection
    await tx.case.update({
      where: { id: caseId },
      data: {
        lifecycle: nextLifecycle,
      },
    });

    // 4. CAUSE — commit ledger event
    await commitLedgerEvent(tx, {
      tenantId,
      caseId,
      eventType: LedgerEventType.CASE_UPDATED,
      actor,
      intentContext,
      payload: {
        from: currentCase.lifecycle,
        to: nextLifecycle,
      },
    });

    return nextLifecycle;
  });
}
