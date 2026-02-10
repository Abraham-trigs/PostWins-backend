import { prisma } from "@/lib/prisma";
import {
  ActorKind,
  DisbursementStatus,
  DisbursementType,
} from "@prisma/client";
import { IllegalLifecycleInvariantViolation } from "@/modules/cases/case.errors";
import { commitLedgerEvent } from "@/modules/routing/commitRoutingLedger";
import { LedgerEventType } from "@prisma/client";

type AuthorizeDisbursementParams = {
  tenantId: string;
  caseId: string;

  type: DisbursementType;

  amount: number;
  currency: string;

  payee: {
    kind: "ORGANIZATION" | "USER" | "EXTERNAL_ACCOUNT";
    id: string;
  };

  actor: {
    kind: ActorKind;
    userId?: string;
    authorityProof: string;
  };
};

export async function authorizeDisbursement(
  params: AuthorizeDisbursementParams,
) {
  return prisma.$transaction(async (tx) => {
    /* -------------------------------------------------
       1️⃣ Idempotency guard — one per case
       ------------------------------------------------- */
    const existing = await tx.disbursement.findUnique({
      where: { caseId: params.caseId },
    });

    if (existing) {
      return existing;
    }

    /* -------------------------------------------------
       2️⃣ Load authoritative facts (read-only)
       ------------------------------------------------- */
    const c = await tx.case.findUnique({
      where: { id: params.caseId },
      include: {
        execution: true,
        verificationRecords: {
          where: { consensusReached: true },
        },
      },
    });

    if (!c) {
      throw new IllegalLifecycleInvariantViolation("Case does not exist");
    }

    /* -------------------------------------------------
       3️⃣ Hard preconditions (absolute)
       ------------------------------------------------- */

    if (c.lifecycle !== "VERIFIED") {
      throw new IllegalLifecycleInvariantViolation("Case is not VERIFIED");
    }

    if (!c.execution) {
      throw new IllegalLifecycleInvariantViolation("Execution does not exist");
    }

    if (c.execution.status !== "COMPLETED") {
      throw new IllegalLifecycleInvariantViolation(
        "Execution is not COMPLETED",
      );
    }

    if (c.verificationRecords.length !== 1) {
      throw new IllegalLifecycleInvariantViolation(
        "Exactly one authoritative verification record is required",
      );
    }

    // NOTE: unresolved flags / disputes would be checked here
    // NOTE: tenant budget check is intentionally read-only here

    /* -------------------------------------------------
       4️⃣ Create AUTHORIZED disbursement (no execution)
       ------------------------------------------------- */
    const disbursement = await tx.disbursement.create({
      data: {
        tenantId: params.tenantId,
        caseId: params.caseId,

        type: params.type,
        status: DisbursementStatus.AUTHORIZED,

        amount: params.amount,
        currency: params.currency,

        payeeKind: params.payee.kind,
        payeeId: params.payee.id,

        actorKind: params.actor.kind,
        actorUserId: params.actor.userId,
        authorityProof: params.actor.authorityProof,

        verificationRecordId: c.verificationRecords[0].id,
        executionId: c.execution.id,
      },
    });

    /* -------------------------------------------------
       5️⃣ Ledger causality — authorization
       ------------------------------------------------- */
    await commitLedgerEvent(tx, {
      tenantId: params.tenantId,
      caseId: params.caseId,
      eventType: LedgerEventType.DISBURSEMENT_AUTHORIZED,
      actor: params.actor,
      payload: {
        disbursementId: disbursement.id,
        amount: params.amount,
        currency: params.currency,
        destination: params.payee,
        verificationRecordId: c.verificationRecords[0].id,
        executionId: c.execution.id,
      },
    });

    return disbursement;
  });
}
