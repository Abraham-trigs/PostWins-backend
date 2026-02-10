import { prisma } from "@/lib/prisma";
import { CaseLifecycle } from "@/modules/cases/CaseLifecycle";
import { orchestrateExecutionVerification } from "@/modules/cases/orchestrateExecutionVerification.service";

type ReconciliationResult = {
  scanned: number;
  advanced: number;
  skipped: number;
};

export async function reconcileExecutionVerification(): Promise<ReconciliationResult> {
  // 1️⃣ Find all cases that are factually ready
  const candidates = await prisma.case.findMany({
    where: {
      lifecycle: CaseLifecycle.EXECUTING,
      execution: {
        status: "COMPLETED",
      },
      verificationRecords: {
        some: {
          consensusReached: true,
        },
      },
    },
    select: {
      id: true,
      tenantId: true,
    },
  });

  let advanced = 0;
  let skipped = 0;

  // 2️⃣ Attempt orchestration (idempotent)
  for (const c of candidates) {
    try {
      await orchestrateExecutionVerification({
        tenantId: c.tenantId,
        caseId: c.id,
        actor: {
          kind: "SYSTEM",
          authorityProof: "RECONCILIATION_JOB",
        },
      });
      advanced++;
    } catch (err) {
      // Any invariant failure means “not actually ready”
      // This is expected under race conditions
      skipped++;
    }
  }

  return {
    scanned: candidates.length,
    advanced,
    skipped,
  };
}
