import { prisma } from "@/lib/prisma";
import { ActorKind, ExecutionStatus, LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/ledger.service";
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

  return prisma.$transaction(async (tx) => {
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

    // 🔒 STEP 10.B — evidence is required before completion
    await assertExecutionEvidenceSatisfied(tx, caseId);

    // 4️⃣ Mark execution as completed
    const completed = await tx.execution.update({
      where: { id: execution.id },
      data: {
        status: ExecutionStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    // 5️⃣ Ledger — explicit fact: execution completed
    await commitLedgerEvent(tx, {
      tenantId,
      caseId,
      eventType: LedgerEventType.EXECUTION_COMPLETED,
      actorKind,
      actorUserId,
      authorityProof,
      intentContext,
      payload: {
        executionId: completed.id,
        completedAt: completed.completedAt,
      },
    });

    return completed;
  });
}
