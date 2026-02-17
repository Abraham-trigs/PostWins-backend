// apps/backend/src/modules/execution/executionEvidence.policy.ts
// Ensures execution cannot complete unless required evidence exists.
// Must be transaction-safe.

import { Prisma, PrismaClient } from "@prisma/client";
import { InvariantViolationError } from "../cases/case.errors";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function assertExecutionEvidenceSatisfied(
  tx: DbClient,
  caseId: string,
): Promise<void> {
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

/* ================================================================
   Design reasoning
   ================================================================ */
// Evidence validation is a lifecycle invariant.
// It must work inside an active transaction to preserve atomicity.
// Accepting both PrismaClient and TransactionClient allows composability
// without breaking isolation guarantees.

///////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////
// - Typed DbClient union
// - Single count query
// - Explicit invariant error
// - No side effects

///////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////
// - Always call this inside the same transaction that mutates execution.
// - Do not load unnecessary evidence records; count is sufficient.
// - Keep invariant enforcement pure and deterministic.

///////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////
// Counting avoids loading rows under high evidence volume.
// Transaction compatibility ensures no race condition between
// evidence insertion and execution completion.
// Lifecycle invariants must remain server-enforced, never client-driven.
///////////////////////////////////////////////////////////////////
