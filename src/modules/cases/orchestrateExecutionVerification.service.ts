import { prisma } from "@/lib/prisma";
import { CaseLifecycle } from "./CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "./transitionCaseLifecycleWithLedger";
import { InvariantViolationError } from "./case.errors";

type OrchestrateExecutionVerificationInput = {
  tenantId: string;
  caseId: string;

  actor: {
    kind: "SYSTEM" | "HUMAN";
    userId?: string;
    authorityProof: string;
  };
};

export async function orchestrateExecutionVerification(
  input: OrchestrateExecutionVerificationInput,
) {
  const { tenantId, caseId, actor } = input;

  return prisma.$transaction(async (tx) => {
    // 1️⃣ Load case (authoritative lifecycle)
    const c = await tx.case.findUniqueOrThrow({
      where: { id: caseId },
      select: { lifecycle: true },
    });

    if (c.lifecycle !== CaseLifecycle.EXECUTING) {
      throw new InvariantViolationError("CASE_NOT_IN_EXECUTING_STATE");
    }

    // 2️⃣ Execution must be completed
    const execution = await tx.execution.findUnique({
      where: { caseId },
      select: { status: true },
    });

    if (!execution || execution.status !== "COMPLETED") {
      throw new InvariantViolationError("EXECUTION_NOT_COMPLETED");
    }

    // 3️⃣ Verification consensus must exist
    const verified = await tx.verificationRecord.findFirst({
      where: {
        caseId,
        consensusReached: true,
      },
      select: { id: true },
    });

    if (!verified) {
      throw new InvariantViolationError("VERIFICATION_NOT_FINALIZED");
    }

    // 4️⃣ Advance lifecycle (single authoritative write)
    return transitionCaseLifecycleWithLedger({
      tenantId,
      caseId,
      target: CaseLifecycle.VERIFIED,
      actor,
      intentContext: {
        executionCompleted: true,
        verificationConsensus: verified.id,
      },
    });
  });
}
