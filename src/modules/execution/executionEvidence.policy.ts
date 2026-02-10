import { PrismaClient } from "@prisma/client";
import { InvariantViolationError } from "../cases/case.errors";

export async function assertExecutionEvidenceSatisfied(
  tx: PrismaClient,
  caseId: string,
) {
  const evidenceCount = await tx.evidence.count({
    where: {
      timelineEntry: {
        caseId,
      },
    },
  });

  if (evidenceCount === 0) {
    throw new InvariantViolationError("EXECUTION_COMPLETION_REQUIRES_EVIDENCE");
  }
}
