import { prisma } from "@/lib/prisma";
import { ActorKind, DisbursementStatus, LedgerEventType } from "@prisma/client";
import { LifecycleInvariantViolationError } from "@/modules/cases/case.errors";
import { commitLedgerEvent } from "@/modules/routing/commitRoutingLedger";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";

type ExecuteDisbursementParams = {
  tenantId: string;
  disbursementId: string;
  actor: {
    kind: ActorKind;
    userId?: string;
    authorityProof: string;
  };
  outcome: { success: true } | { success: false; reason: string };
};

export async function executeDisbursement(params: ExecuteDisbursementParams) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.disbursement.findUnique({
      where: { id: params.disbursementId },
    });

    if (!d) {
      throw new LifecycleInvariantViolationError("Disbursement does not exist");
    }

    if (d.status !== DisbursementStatus.AUTHORIZED) {
      throw new LifecycleInvariantViolationError(
        "Disbursement must be in AUTHORIZED state",
      );
    }

    // Mark EXECUTING (in-flight truth)
    await tx.disbursement.update({
      where: { id: d.id },
      data: { status: DisbursementStatus.EXECUTING },
    });

    if (params.outcome.success) {
      const completed = await tx.disbursement.update({
        where: { id: d.id },
        data: {
          status: DisbursementStatus.COMPLETED,
          executedAt: new Date(),
        },
      });

      await commitLedgerEvent(tx, {
        tenantId: params.tenantId,
        caseId: d.caseId,
        eventType: LedgerEventType.DISBURSEMENT_COMPLETED,
        actor: params.actor,
        payload: buildAuthorityEnvelopeV1({
          domain: "DISBURSEMENT",
          event: "COMPLETED",
          data: {
            disbursementId: d.id,
            amount: d.amount,
            currency: d.currency,
            payeeKind: d.payeeKind,
            payeeId: d.payeeId,
            verificationRecordId: d.verificationRecordId,
            executionId: d.executionId,
          },
        }),
      });

      return completed;
    }

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
      payload: buildAuthorityEnvelopeV1({
        domain: "DISBURSEMENT",
        event: "FAILED",
        data: {
          disbursementId: d.id,
          reason: params.outcome.reason,
        },
      }),
    });

    return failed;
  });
}
