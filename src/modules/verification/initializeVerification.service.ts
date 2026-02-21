// apps/backend/src/modules/verification/initializeVerification.service.ts
// Initializes verification phase after execution completion.
// Creates canonical VerificationRecord + required roles + ledger event.
// Must be called inside an existing transaction.

import { Prisma, ActorKind, LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import { InvariantViolationError } from "@/modules/cases/case.errors";
import crypto from "node:crypto";

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

type InitializeVerificationParams = {
  tenantId: string;
  caseId: string;
};

type VerificationActor = {
  kind: ActorKind;
  userId?: string;
  authorityProof: string;
};

////////////////////////////////////////////////////////////////
// Helper
////////////////////////////////////////////////////////////////

function uuid() {
  return crypto.randomUUID();
}

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export async function initializeVerification(
  tx: Prisma.TransactionClient,
  params: InitializeVerificationParams,
  actor: VerificationActor,
) {
  const { tenantId, caseId } = params;

  //////////////////////////////////////////////////////////////////
  // 1️⃣ Prevent duplicate active verification
  //////////////////////////////////////////////////////////////////
  const existing = await tx.verificationRecord.findFirst({
    where: {
      tenantId,
      caseId,
      consensusReached: false,
    },
  });

  if (existing) {
    return existing; // idempotent
  }

  //////////////////////////////////////////////////////////////////
  // 2️⃣ Execution must already be completed
  //////////////////////////////////////////////////////////////////
  const execution = await tx.execution.findFirst({
    where: {
      tenantId,
      caseId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!execution || execution.status !== "COMPLETED") {
    throw new InvariantViolationError(
      "VERIFICATION_REQUIRES_COMPLETED_EXECUTION",
    );
  }

  //////////////////////////////////////////////////////////////////
  // 3️⃣ Resolve required verification roles (tenant-scoped)
  //////////////////////////////////////////////////////////////////
  const verifierRole = await tx.role.findFirst({
    where: {
      tenantId,
      key: "VERIFIER",
    },
  });

  if (!verifierRole) {
    throw new InvariantViolationError(
      "VERIFIER_ROLE_NOT_CONFIGURED_FOR_TENANT",
    );
  }

  //////////////////////////////////////////////////////////////////
  // 4️⃣ Create VerificationRecord
  //////////////////////////////////////////////////////////////////
  const record = await tx.verificationRecord.create({
    data: {
      id: uuid(),
      tenantId,
      caseId,
      requiredVerifiers: 2,
      routedAt: new Date(),
    },
  });

  //////////////////////////////////////////////////////////////////
  // 5️⃣ Create required role mapping
  // ⚠️ Schema FIX: model does NOT include tenantId
  //////////////////////////////////////////////////////////////////
  await tx.verificationRequiredRole.create({
    data: {
      id: uuid(),
      verificationRecordId: record.id,
      roleKey: verifierRole.key,
    },
  });

  //////////////////////////////////////////////////////////////////
  // 6️⃣ Ledger — VERIFICATION_STARTED
  //////////////////////////////////////////////////////////////////
  await commitLedgerEvent(
    {
      tenantId,
      caseId,
      eventType: LedgerEventType.VERIFICATION_STARTED,
      actor,
      payload: buildAuthorityEnvelopeV1({
        domain: "VERIFICATION",
        event: "VERIFICATION_STARTED",
        data: {
          verificationRecordId: record.id,
          requiredVerifiers: record.requiredVerifiers,
          requiredRole: verifierRole.key,
        },
      }),
    },
    tx,
  );

  return record;
}

////////////////////////////////////////////////////////////////
/// Design reasoning
////////////////////////////////////////////////////////////////
// Verification must initialize atomically and deterministically.
// Idempotency prevents duplicate verification phases under retries.
// Schema alignment is strict — child role mapping inherits tenant via record.

////////////////////////////////////////////////////////////////
/// Structure
////////////////////////////////////////////////////////////////
// - Guard duplicate active record
// - Enforce execution completion invariant
// - Resolve tenant role
// - Create verificationRecord
// - Create verificationRequiredRole (schema-aligned)
// - Commit ledger event

////////////////////////////////////////////////////////////////
/// Implementation guidance
////////////////////////////////////////////////////////////////
// Must run inside same transaction as execution completion.
// Never mutate lifecycle here.
// Future: compute requiredVerifiers from policy engine.

////////////////////////////////////////////////////////////////
/// Scalability insight
////////////////////////////////////////////////////////////////
// Role mapping is tenant-isolated via parent record.
// Policy engine can later expand to multi-role quorum without schema change.
////////////////////////////////////////////////////////////////
