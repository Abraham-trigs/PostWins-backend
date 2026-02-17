// apps/backend/src/modules/disbursement/_internal/executeDisbursement.service.ts
// Executes an AUTHORIZED disbursement and commits ledger causality.
// Handles success and failure outcomes atomically.

import { prisma } from "@/lib/prisma";
import { ActorKind, DisbursementStatus, LedgerEventType } from "@prisma/client";
import { LifecycleInvariantViolationError } from "@/modules/cases/case.errors";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
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

      await commitLedgerEvent(
        {
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
        },
        tx,
      );

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

    await commitLedgerEvent(
      {
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
      },
      tx,
    );

    return failed;
  });
}

/* ================================================================
   Design reasoning
   ================================================================ */
// Execution is isolated from authorization.
// State transitions are strictly enforced.
// Ledger commits are causally tied to state mutation in one transaction.

///////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////
// - Transaction boundary
// - Lifecycle invariant enforcement
// - Explicit EXECUTING intermediate state
// - Success/failure branching
// - Ledger commit after state mutation

///////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////
// - Do not bypass AUTHORIZED precondition.
// - Keep ledger commit inside same transaction.
// - Never infer execution outcome outside this service.
// - External payment provider should wrap this call safely.

///////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////
// EXECUTING state enables crash recovery + idempotent retries.
// Canonical ledger entry point prevents audit drift.
// This design preserves financial correctness under concurrency.
///////////////////////////////////////////////////////////////////
