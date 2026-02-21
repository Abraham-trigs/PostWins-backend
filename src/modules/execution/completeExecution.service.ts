// apps/backend/src/modules/execution/completeExecution.service.ts
// Marks execution as COMPLETED after invariant + evidence validation.
// Commits canonical ledger event inside transaction.
// Automatically initializes verification phase inside the same transaction.

import { prisma } from "@/lib/prisma";
import {
  Prisma,
  ActorKind,
  ExecutionStatus,
  LedgerEventType,
} from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { InvariantViolationError } from "@/modules/cases/case.errors";
import { assertExecutionEvidenceSatisfied } from "./executionEvidence.policy";
import { initializeVerification } from "@/modules/verification/initializeVerification.service";

////////////////////////////////////////////////////////////////
// Type
////////////////////////////////////////////////////////////////

type CompleteExecutionInput = {
  tenantId: string;
  caseId: string;

  actorKind: ActorKind;
  actorUserId?: string;

  authorityProof: string;
  intentContext?: Record<string, unknown>;
};

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export async function completeExecution(input: CompleteExecutionInput) {
  const {
    tenantId,
    caseId,
    actorKind,
    actorUserId,
    authorityProof,
    intentContext,
  } = input;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    //////////////////////////////////////////////////////////////////
    // 1️⃣ Load execution (must exist)
    //////////////////////////////////////////////////////////////////
    const execution = await tx.execution.findFirst({
      where: { caseId, tenantId },
    });

    if (!execution) {
      throw new InvariantViolationError("EXECUTION_NOT_FOUND");
    }

    //////////////////////////////////////////////////////////////////
    // 2️⃣ Idempotency: already completed → return as-is
    //////////////////////////////////////////////////////////////////
    if (execution.status === ExecutionStatus.COMPLETED) {
      return execution;
    }

    //////////////////////////////////////////////////////////////////
    // 3️⃣ Prevent illegal completion states
    //////////////////////////////////////////////////////////////////
    if (execution.status === ExecutionStatus.ABORTED) {
      throw new InvariantViolationError(
        "ABORTED_EXECUTION_CANNOT_BE_COMPLETED",
      );
    }

    //////////////////////////////////////////////////////////////////
    // 4️⃣ Evidence must be satisfied before completion
    //////////////////////////////////////////////////////////////////
    await assertExecutionEvidenceSatisfied(tx, caseId);

    //////////////////////////////////////////////////////////////////
    // 5️⃣ Mark execution as completed
    //////////////////////////////////////////////////////////////////
    const completed = await tx.execution.update({
      where: { id: execution.id },
      data: {
        status: ExecutionStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    //////////////////////////////////////////////////////////////////
    // 6️⃣ Ledger — canonical structured commit
    //////////////////////////////////////////////////////////////////
    await commitLedgerEvent(
      {
        tenantId,
        caseId,
        eventType: LedgerEventType.EXECUTION_COMPLETED,
        actor: {
          kind: actorKind,
          userId: actorUserId,
          authorityProof,
        },
        intentContext,
        payload: {
          executionId: completed.id,
          completedAt: completed.completedAt,
        },
      },
      tx,
    );

    //////////////////////////////////////////////////////////////////
    // 7️⃣ Initialize verification phase (atomic with completion)
    //
    // - Idempotent
    // - Does NOT mutate lifecycle
    // - Creates verificationRecord + required roles
    // - Commits VERIFICATION_STARTED ledger event
    //////////////////////////////////////////////////////////////////
    await initializeVerification(
      tx,
      { tenantId, caseId },
      {
        kind: actorKind,
        userId: actorUserId,
        authorityProof,
      },
    );

    return completed;
  });
}

////////////////////////////////////////////////////////////////
/// Design reasoning
////////////////////////////////////////////////////////////////
// Execution completion is a constitutional lifecycle boundary.
// Verification must begin immediately and atomically after completion.
// Keeping initialization inside the same transaction guarantees:
// - No execution completed without verification
// - No orphan verification records
// - No governance drift under concurrency.

////////////////////////////////////////////////////////////////
/// Structure
////////////////////////////////////////////////////////////////
// - Transaction boundary (typed explicitly)
// - Idempotency protection
// - Invariant enforcement
// - Evidence assertion policy
// - Canonical ledger commit (EXECUTION_COMPLETED)
// - Verification initialization (VERIFICATION_STARTED)

////////////////////////////////////////////////////////////////
/// Implementation guidance
////////////////////////////////////////////////////////////////
// - Do not bypass evidence validation.
// - Keep verification initialization inside same transaction.
// - Do not mutate lifecycle here.
// - initializeVerification must remain idempotent.
// - Never expose partially completed execution.

////////////////////////////////////////////////////////////////
/// Scalability insight
////////////////////////////////////////////////////////////////
// Atomic execution → verification handoff prevents race conditions.
// Idempotency ensures retry-safe orchestration under load.
// Verification policy can evolve independently without changing this boundary.
// This keeps lifecycle graph deterministic and replay-safe.
////////////////////////////////////////////////////////////////
