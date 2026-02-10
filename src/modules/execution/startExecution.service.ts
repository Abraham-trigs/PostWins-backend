import { prisma } from "@/lib/prisma";
import { ActorKind, ExecutionStatus, LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/ledger.service";
import { InvariantViolationError } from "@/modules/cases/case.errors";

type StartExecutionInput = {
  tenantId: string;
  caseId: string;

  actorKind: ActorKind;
  actorUserId?: string;

  intentContext?: Record<string, unknown>;
};

export async function startExecution(input: StartExecutionInput) {
  const { tenantId, caseId, actorKind, actorUserId, intentContext } = input;

  return prisma.$transaction(async (tx) => {
    // 1. Ensure case exists and belongs to tenant
    const caseRecord = await tx.case.findFirst({
      where: {
        id: caseId,
        tenantId,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (!caseRecord) {
      throw new InvariantViolationError("CASE_NOT_FOUND_OR_ARCHIVED");
    }

    // 2. Enforce single execution per case (idempotent read)
    const existingExecution = await tx.execution.findUnique({
      where: { caseId },
    });

    if (existingExecution) {
      return existingExecution;
    }

    // 3. Create execution (existence proof only)
    const execution = await tx.execution.create({
      data: {
        tenantId,
        caseId,
        status: ExecutionStatus.CREATED,
        startedAt: new Date(),
        startedByUserId: actorUserId ?? null,
      },
    });

    // 4. Ledger: execution started
    await commitLedgerEvent(tx, {
      tenantId,
      caseId,
      eventType: LedgerEventType.EXECUTION_STARTED,
      actorKind,
      actorUserId,
      intentContext,
      payload: {
        executionId: execution.id,
        status: execution.status,
      },
    });

    return execution;
  });
}
