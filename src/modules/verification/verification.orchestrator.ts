import { CaseLifecycle } from "../cases/CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "../routing/commitRoutingLedger";
import { Prisma } from "@prisma/client";
import { isVerificationTimedOut } from "./isVerificationTimedOut";

/**
 * FINALIZATION PATHS — STEP 10.7 + 10.8
 *
 * These functions are the ONLY places where verification
 * outcomes are allowed to cause lifecycle or ledger effects.
 *
 * They are called exclusively by the verification orchestrator.
 */

const VERIFICATION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  actor: {
    kind: "HUMAN" | "SYSTEM";
    userId?: string;
    authorityProof: string;
  },
) {
  // ⏳ STEP 10.8 — timeout check (governance intrusion)
  const timedOut = isVerificationTimedOut({
    createdAt: record.createdAt,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });

  if (timedOut) {
    await commitLedgerEvent(tx, {
      tenantId: record.tenantId,
      caseId: record.caseId,
      eventType: LedgerEventType.VERIFICATION_TIMED_OUT,
      actor,
      payload: {
        verificationRecordId: record.id,
        createdAt: record.createdAt,
      },
    });

    // ❗ No lifecycle change
    // Escalation required
    return;
  }

  // 1️⃣ Lifecycle transition
  await transitionCaseLifecycleWithLedger({
    tenantId: record.tenantId,
    caseId: record.caseId,
    target: CaseLifecycle.VERIFIED,
    actor,
    intentContext: {
      verificationRecordId: record.id,
    },
  });

  // 2️⃣ Ledger fact
  await commitLedgerEvent(tx, {
    tenantId: record.tenantId,
    caseId: record.caseId,
    eventType: LedgerEventType.VERIFIED,
    actor,
    payload: {
      verificationRecordId: record.id,
    },
  });
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
  actor: {
    kind: "HUMAN" | "SYSTEM";
    userId?: string;
    authorityProof: string;
  },
) {
  // ⏳ STEP 10.8 — timeout check
  const timedOut = isVerificationTimedOut({
    createdAt: record.createdAt,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });

  if (timedOut) {
    await commitLedgerEvent(tx, {
      tenantId: record.tenantId,
      caseId: record.caseId,
      eventType: LedgerEventType.VERIFICATION_TIMED_OUT,
      actor,
      payload: {
        verificationRecordId: record.id,
        createdAt: record.createdAt,
      },
    });

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

  await commitLedgerEvent(tx, {
    tenantId: record.tenantId,
    caseId: record.caseId,
    eventType: LedgerEventType.VERIFICATION_REJECTED,
    actor,
    payload: {
      verificationRecordId: record.id,
    },
  });
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
  actor: {
    kind: "HUMAN" | "SYSTEM";
    userId?: string;
    authorityProof: string;
  },
) {
  // ⏳ STEP 10.8 — timeout check
  const timedOut = isVerificationTimedOut({
    createdAt: record.createdAt,
    timeoutMs: VERIFICATION_TIMEOUT_MS,
  });

  if (timedOut) {
    await commitLedgerEvent(tx, {
      tenantId: record.tenantId,
      caseId: record.caseId,
      eventType: LedgerEventType.VERIFICATION_TIMED_OUT,
      actor,
      payload: {
        verificationRecordId: record.id,
        createdAt: record.createdAt,
      },
    });

    return;
  }

  // ⚠️ No lifecycle change here
  // Human governance must decide next
  await commitLedgerEvent(tx, {
    tenantId: record.tenantId,
    caseId: record.caseId,
    eventType: LedgerEventType.VERIFICATION_DISPUTED,
    actor,
    payload: {
      verificationRecordId: record.id,
    },
  });
}
