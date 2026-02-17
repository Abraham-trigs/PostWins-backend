// apps/backend/src/modules/disbursement/_internal/authorizeDisbursement.service.ts
// Authorizes a disbursement after strict lifecycle validation.
// Does NOT execute funds transfer. Creates AUTHORIZED record + ledger event.

import { prisma } from "@/lib/prisma";
import {
  ActorKind,
  DisbursementStatus,
  DisbursementType,
  LedgerEventType,
} from "@prisma/client";
import { IllegalLifecycleInvariantViolation } from "@/modules/cases/case.errors";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";

/* ---------------------------------------------
   Capability types (CRITICAL)
--------------------------------------------- */

export type AuthorizedDisbursement = {
  kind: "AUTHORIZED";
  disbursementId: string;
};

export type AuthorizationDenied = {
  kind: "DENIED";
  reason: string;
};

export type AuthorizationResult = AuthorizedDisbursement | AuthorizationDenied;

/* ---------------------------------------------
   Params
--------------------------------------------- */

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

/* ---------------------------------------------
   Authorization (NO EXECUTION)
--------------------------------------------- */

export async function authorizeDisbursement(
  params: AuthorizeDisbursementParams,
): Promise<AuthorizationResult> {
  return prisma.$transaction(async (tx) => {
    /* -------------------------------------------------
       1️⃣ Idempotency guard — one per case
       ------------------------------------------------- */
    const existing = await tx.disbursement.findUnique({
      where: { caseId: params.caseId },
      select: { id: true, status: true },
    });

    if (existing) {
      if (existing.status !== DisbursementStatus.AUTHORIZED) {
        return {
          kind: "DENIED",
          reason: "Disbursement already exists and is not AUTHORIZED",
        };
      }

      return {
        kind: "AUTHORIZED",
        disbursementId: existing.id,
      };
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

    /* -------------------------------------------------
       4️⃣ Create AUTHORIZED disbursement (NO execution)
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
    await commitLedgerEvent(
      {
        tenantId: params.tenantId,
        caseId: params.caseId,
        eventType: LedgerEventType.DISBURSEMENT_AUTHORIZED,
        actor: params.actor,
        payload: buildAuthorityEnvelopeV1({
          domain: "DISBURSEMENT",
          event: "AUTHORIZED",
          data: {
            disbursementId: disbursement.id,
            amount: params.amount,
            currency: params.currency,
            destination: params.payee,
            verificationRecordId: c.verificationRecords[0].id,
            executionId: c.execution.id,
          },
        }),
      },
      tx,
    );

    return {
      kind: "AUTHORIZED",
      disbursementId: disbursement.id,
    };
  });
}

/* ================================================================
   Design reasoning
   ================================================================ */
// Strict lifecycle enforcement prevents premature disbursement.
// Authorization and execution are deliberately separated.
// Ledger event is causally tied inside the same transaction.

///////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////
// - Transaction boundary
// - Idempotency guard
// - Hard lifecycle invariants
// - Write AUTHORIZED state
// - Commit ledger event

///////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////
// - Do NOT collapse authorization + execution.
// - Never bypass lifecycle checks.
// - Ledger must remain in same transaction.
// - Do not trust client lifecycle assumptions.

///////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////
// Separation of authorization from execution allows:
// - Async fund settlement
// - Retry-safe execution engines
// - External payment provider orchestration
// - Clear audit timeline
//
// This protects financial correctness under scale.
///////////////////////////////////////////////////////////////////
