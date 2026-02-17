// apps/backend/src/modules/execution/completeExecution.service.ts
// Marks execution as COMPLETED after invariant + evidence validation.
// Commits canonical ledger event inside transaction.

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

type CompleteExecutionInput = {
  tenantId: string;
  caseId: string;

  actorKind: ActorKind;
  actorUserId?: string;

  authorityProof: string;
  intentContext?: Record<string, unknown>;
};

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
    // 1️⃣ Load execution (must exist)
    const execution = await tx.execution.findUnique({
      where: { caseId },
    });

    if (!execution) {
      throw new InvariantViolationError("EXECUTION_NOT_FOUND");
    }

    // 2️⃣ Idempotency: already completed → return as-is
    if (execution.status === ExecutionStatus.COMPLETED) {
      return execution;
    }

    // 3️⃣ Prevent illegal completion states
    if (execution.status === ExecutionStatus.ABORTED) {
      throw new InvariantViolationError(
        "ABORTED_EXECUTION_CANNOT_BE_COMPLETED",
      );
    }

    // 🔒 Evidence must be satisfied before completion
    await assertExecutionEvidenceSatisfied(tx, caseId);

    // 4️⃣ Mark execution as completed
    const completed = await tx.execution.update({
      where: { id: execution.id },
      data: {
        status: ExecutionStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    // 5️⃣ Ledger — canonical structured commit
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

    return completed;
  });
}

/* ================================================================
   Design reasoning
   ================================================================ */
// Execution completion is a constitutional lifecycle boundary.
// Evidence validation is mandatory before transition.
// Ledger commit is atomic with the state mutation.

///////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////
// - Transaction boundary (typed explicitly)
// - Idempotency protection
// - Invariant enforcement
// - Evidence assertion policy
// - Canonical ledger commit

///////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////
// - Do not bypass evidence validation.
// - Keep ledger commit inside same transaction.
// - Actor must always be structured.
// - Never expose partially completed execution.

///////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////
// Explicit transaction typing prevents accidental client misuse.
// Canonical ledger entry ensures audit integrity.
// Idempotency allows retry-safe orchestration under load.
///////////////////////////////////////////////////////////////////
