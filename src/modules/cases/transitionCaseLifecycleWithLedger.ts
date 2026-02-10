import { prisma } from "@/lib/prisma";
import { CaseLifecycle } from "./CaseLifecycle";
import { transitionCaseLifecycle } from "./transitionCaseLifecycle";
import { LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "../routing/commitRoutingLedger";

/**
 * Enforced lifecycle transition with ledger authority.
 *
 * 🔒 Invariant:
 * Lifecycle change without ledger = impossible
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
  return prisma.$transaction(async (tx) => {
    // 1. Load current authoritative state
    const c = await tx.case.findUniqueOrThrow({
      where: { id: params.caseId },
      select: { lifecycle: true },
    });

    // 2. Apply pure domain law (may throw)
    const next = transitionCaseLifecycle({
      caseId: params.caseId,
      current: c.lifecycle,
      target: params.target,
    });

    // 3. EFFECT — update projection
    await tx.case.update({
      where: { id: params.caseId },
      data: { lifecycle: next },
    });

    // 4. CAUSE — commit ledger event (mandatory)
    await commitLedgerEvent(tx, {
      tenantId: params.tenantId,
      caseId: params.caseId,
      eventType: LedgerEventType.CASE_UPDATED,
      actor: params.actor,
      intentContext: params.intentContext,
      payload: {
        from: c.lifecycle,
        to: next,
      },
    });

    return next;
  });
}
