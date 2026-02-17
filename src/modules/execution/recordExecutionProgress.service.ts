import { prisma } from "@/lib/prisma";
import { InvariantViolationError } from "@/modules/cases/case.errors";
import { Prisma } from "@prisma/client";
import { ExecutionProgressLabel } from "./executionProgress.labels";

type RecordExecutionProgressInput = {
  tenantId: string;
  caseId: string;

  label: ExecutionProgressLabel;
  detail?: Record<string, unknown>;

  actorUserId?: string;
};

export async function recordExecutionProgress(
  input: RecordExecutionProgressInput,
) {
  const { caseId, label, detail } = input;

  return prisma.$transaction(async (tx) => {
    // 1️⃣ Execution must exist
    const execution = await tx.execution.findUnique({
      where: { caseId },
      select: { id: true },
    });

    if (!execution) {
      throw new InvariantViolationError(
        "EXECUTION_PROGRESS_REQUIRES_EXECUTION",
      );
    }

    // 2️⃣ Record progress (non-authoritative)
    const progress = await tx.executionProgress.create({
      data: {
        executionId: execution.id,
        label,
        detail: detail as Prisma.InputJsonValue,
      },
    });

    return progress;
  });
}
