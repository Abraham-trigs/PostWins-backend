import { prisma } from "@/lib/prisma";
import { CaseLifecycle } from "../cases/CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "./commitAcceptanceLedger";

/**
 * Acceptance command.
 *
 * 🧠 Key:
 * - Ownership becomes explicit here.
 * - Humans and systems share the same path.
 * - No special-casing beyond actor.kind.
 */
export async function acceptCase(params: {
  tenantId: string;
  caseId: string;
  userId?: string;
  isSystem?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.caseAssignment.findUniqueOrThrow({
      where: { caseId: params.caseId },
    });

    // 🔒 Membership check MUST exist (execution body membership)
    // Do not commit without this guard

    const actor = {
      kind: params.isSystem ? "SYSTEM" : "HUMAN",
      userId: params.userId,
      authorityProof: params.isSystem
        ? "KHALISTAR_EXECUTION_AUTHORITY"
        : "EXECUTION_BODY_ACCEPTANCE",
    } as const;

    await transitionCaseLifecycleWithLedger({
      tenantId: params.tenantId,
      caseId: params.caseId,
      target: CaseLifecycle.ACCEPTED,
      actor,
    });

    await commitLedgerEvent(tx, {
      tenantId: params.tenantId,
      caseId: params.caseId,
      eventType: LedgerEventType.CASE_ACCEPTED,
      actor,
      payload: {
        executionBodyId: assignment.executionBodyId,
      },
    });
  });
}
