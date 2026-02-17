// apps/backend/src/modules/verification/verification.finalization.ts
// Finalizes verification outcomes and commits canonical ledger events.
// All lifecycle + ledger effects are transaction-bound.

import { CaseLifecycle } from "../cases/CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { LedgerEventType, Prisma, ActorKind } from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { isVerificationTimedOut } from "./isVerificationTimedOut";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";

/**
 * FINALIZATION PATHS — STEP 10.7 + 10.8
 *
 * These functions are the ONLY places where verification
 * outcomes are allowed to cause lifecycle or ledger effects.
 *
 * Authority Envelope V1 is mandatory for all ledger payloads.
 */

const VERIFICATION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type VerificationActor = {
  kind: ActorKind;
  userId?: string;
  authorityProof: string;
};

/* =========================
   ACCEPTED
   ========================= */
export async function finalizeVerificationAccepted(
  tx: Prisma.TransactionClient,
  record: {
    id: string;
    tenantId: string;
    caseId: string;
    createdAt: Date;
  },
  actor: VerificationActor,
) {
  const timedOut = isVerificationTimedOut({
    createdAt: record.createdAt,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });

  if (timedOut) {
    await commitLedgerEvent(
      {
        tenantId: record.tenantId,
        caseId: record.caseId,
        eventType: LedgerEventType.VERIFICATION_TIMED_OUT,
        actor,
        payload: buildAuthorityEnvelopeV1({
          domain: "VERIFICATION",
          event: "VERIFICATION_TIMED_OUT",
          data: {
            verificationRecordId: record.id,
            createdAt: record.createdAt,
          },
        }),
      },
      tx,
    );

    return;
  }

  await transitionCaseLifecycleWithLedger({
    tenantId: record.tenantId,
    caseId: record.caseId,
    target: CaseLifecycle.VERIFIED,
    actor,
    intentContext: {
      verificationRecordId: record.id,
    },
  });

  await commitLedgerEvent(
    {
      tenantId: record.tenantId,
      caseId: record.caseId,
      eventType: LedgerEventType.VERIFIED,
      actor,
      payload: buildAuthorityEnvelopeV1({
        domain: "VERIFICATION",
        event: "VERIFIED",
        data: {
          verificationRecordId: record.id,
        },
      }),
    },
    tx,
  );
}

/* =========================
   REJECTED
   ========================= */
export async function finalizeVerificationRejected(
  tx: Prisma.TransactionClient,
  record: {
    id: string;
    tenantId: string;
    caseId: string;
    createdAt: Date;
  },
  actor: VerificationActor,
) {
  const timedOut = isVerificationTimedOut({
    createdAt: record.createdAt,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });

  if (timedOut) {
    await commitLedgerEvent(
      {
        tenantId: record.tenantId,
        caseId: record.caseId,
        eventType: LedgerEventType.VERIFICATION_TIMED_OUT,
        actor,
        payload: buildAuthorityEnvelopeV1({
          domain: "VERIFICATION",
          event: "VERIFICATION_TIMED_OUT",
          data: {
            verificationRecordId: record.id,
            createdAt: record.createdAt,
          },
        }),
      },
      tx,
    );

    return;
  }

  await transitionCaseLifecycleWithLedger({
    tenantId: record.tenantId,
    caseId: record.caseId,
    target: CaseLifecycle.FLAGGED,
    actor,
    intentContext: {
      verificationRecordId: record.id,
    },
  });

  await commitLedgerEvent(
    {
      tenantId: record.tenantId,
      caseId: record.caseId,
      eventType: LedgerEventType.VERIFICATION_REJECTED,
      actor,
      payload: buildAuthorityEnvelopeV1({
        domain: "VERIFICATION",
        event: "VERIFICATION_REJECTED",
        data: {
          verificationRecordId: record.id,
        },
      }),
    },
    tx,
  );
}

/* =========================
   DISPUTED → ESCALATION
   ========================= */
export async function escalateVerification(
  tx: Prisma.TransactionClient,
  record: {
    id: string;
    tenantId: string;
    caseId: string;
    createdAt: Date;
  },
  actor: VerificationActor,
) {
  const timedOut = isVerificationTimedOut({
    createdAt: record.createdAt,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });

  if (timedOut) {
    await commitLedgerEvent(
      {
        tenantId: record.tenantId,
        caseId: record.caseId,
        eventType: LedgerEventType.VERIFICATION_TIMED_OUT,
        actor,
        payload: buildAuthorityEnvelopeV1({
          domain: "VERIFICATION",
          event: "VERIFICATION_TIMED_OUT",
          data: {
            verificationRecordId: record.id,
            createdAt: record.createdAt,
          },
        }),
      },
      tx,
    );

    return;
  }

  await commitLedgerEvent(
    {
      tenantId: record.tenantId,
      caseId: record.caseId,
      eventType: LedgerEventType.VERIFICATION_DISPUTED,
      actor,
      payload: buildAuthorityEnvelopeV1({
        domain: "VERIFICATION",
        event: "VERIFICATION_DISPUTED",
        data: {
          verificationRecordId: record.id,
        },
      }),
    },
    tx,
  );
}

/* ================================================================
   Design reasoning
   ================================================================ */
// Verification finalization is the only legal lifecycle trigger.
// Timeout governance is enforced before any transition.
// Ledger commits are atomic with lifecycle mutation.

///////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////
// - Transaction-bound finalization
// - Timeout governance check
// - Structured actor enforcement
// - Canonical ledger commit

///////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////
// - Do not allow lifecycle mutation outside this file.
// - Always use Authority Envelope V1.
// - Keep all ledger commits inside same transaction.
// - Actor must be structured and enum-safe.

///////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////
// Centralizing verification effects prevents drift.
// Timeout enforcement avoids silent governance deadlocks.
// Canonical ledger entry ensures audit consistency under concurrency.
///////////////////////////////////////////////////////////////////
