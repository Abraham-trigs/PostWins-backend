import { prisma } from "@/lib/prisma";
import { ActorKind, DisbursementStatus } from "@prisma/client";
import { IllegalLifecycleInvariantViolation } from "@/modules/cases/case.errors";
import { commitLedgerEvent } from "@/modules/routing/commitRoutingLedger";
import { LedgerEventType } from "@prisma/client";

type ExecuteDisbursementParams = {
  tenantId: string;
  disbursementId: string;

  actor: {
    kind: ActorKind;
    userId?: string;
    authorityProof: string;
  };

  // Result of the real-world attempt
  outcome: { success: true } | { success: false; reason: string };
};

export async function executeDisbursement(params: ExecuteDisbursementParams) {
  return prisma.$transaction(async (tx) => {
    /* -------------------------------------------------
       1️⃣ Load disbursement (authoritative)
       ------------------------------------------------- */
    const d = await tx.disbursement.findUnique({
      where: { id: params.disbursementId },
    });

    if (!d) {
      throw new IllegalLifecycleInvariantViolation(
        "Disbursement does not exist",
      );
    }

    if (d.status !== DisbursementStatus.AUTHORIZED) {
      throw new IllegalLifecycleInvariantViolation(
        "Disbursement is not in AUTHORIZED state",
      );
    }

    /* -------------------------------------------------
       2️⃣ Apply real-world outcome (irreversible)
       ------------------------------------------------- */

    if (params.outcome.success) {
      const executed = await tx.disbursement.update({
        where: { id: d.id },
        data: {
          status: DisbursementStatus.EXECUTED,
          executedAt: new Date(),
        },
      });

      /* -------------------------------------------------
         3️⃣ Ledger truth — execution
         ------------------------------------------------- */
      await commitLedgerEvent(tx, {
        tenantId: params.tenantId,
        caseId: d.caseId,
        eventType: LedgerEventType.DISBURSEMENT_EXECUTED,
        actor: params.actor,
        payload: {
          disbursementId: d.id,
          amount: d.amount,
          currency: d.currency,
          destination: {
            kind: d.payeeKind,
            id: d.payeeId,
          },
          verificationRecordId: d.verificationRecordId,
          executionId: d.executionId,
        },
      });

      return executed;
    }

    /* -------------------------------------------------
       4️⃣ Failure path — first-class truth
       ------------------------------------------------- */
    const failed = await tx.disbursement.update({
      where: { id: d.id },
      data: {
        status: DisbursementStatus.FAILED,
        failedAt: new Date(),
        failureReason: params.outcome.reason,
      },
    });

    await commitLedgerEvent(tx, {
      tenantId: params.tenantId,
      caseId: d.caseId,
      eventType: LedgerEventType.DISBURSEMENT_FAILED,
      actor: params.actor,
      payload: {
        disbursementId: d.id,
        reason: params.outcome.reason,
      },
    });

    return failed;
  });
}
