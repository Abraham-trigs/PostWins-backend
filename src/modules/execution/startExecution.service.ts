// apps/backend/src/modules/execution/startExecution.service.ts
// Creates execution existence proof for a case.
// Commits canonical EXECUTION_STARTED ledger event atomically.

import { prisma } from "@/lib/prisma";
import { ActorKind, ExecutionStatus, LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { InvariantViolationError } from "@/modules/cases/case.errors";

type StartExecutionInput = {
  tenantId: string;
  caseId: string;

  actorKind: ActorKind;
  actorUserId?: string;

  authorityProof: string;
  intentContext?: Record<string, unknown>;
};

export async function startExecution(input: StartExecutionInput) {
  const {
    tenantId,
    caseId,
    actorKind,
    actorUserId,
    authorityProof,
    intentContext,
  } = input;

  return prisma.$transaction(async (tx) => {
    // 1️⃣ Ensure case exists and belongs to tenant
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

    // 2️⃣ Enforce single execution per case (idempotent read)
    const existingExecution = await tx.execution.findUnique({
      where: { caseId },
    });

    if (existingExecution) {
      return existingExecution;
    }

    // 3️⃣ Create execution (existence proof only)
    const execution = await tx.execution.create({
      data: {
        tenantId,
        caseId,
        status: ExecutionStatus.CREATED,
        startedAt: new Date(),
        startedByUserId: actorUserId ?? null,
      },
    });

    // 4️⃣ Ledger: execution started (canonical structured call)
    await commitLedgerEvent(
      {
        tenantId,
        caseId,
        eventType: LedgerEventType.EXECUTION_STARTED,
        actor: {
          kind: actorKind,
          userId: actorUserId,
          authorityProof,
        },
        intentContext,
        payload: {
          executionId: execution.id,
          status: execution.status,
        },
      },
      tx,
    );

    return execution;
  });
}

/* ================================================================
   Design reasoning
   ================================================================ */
// Execution start is an existence proof, not lifecycle completion.
// Idempotency prevents duplicate execution records.
// Ledger event is atomic with execution creation.

///////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////
// - Transaction boundary
// - Tenant ownership validation
// - Idempotent execution creation
// - Canonical structured ledger commit

///////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////
// - Never start execution without authorityProof.
// - Do not bypass tenant boundary checks.
// - Keep ledger commit inside same transaction.
// - Treat execution as lifecycle anchor, not workflow logic.

///////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////
// Idempotency enables retry-safe orchestration.
// Canonical ledger entry guarantees audit consistency.
// Transaction containment prevents ghost execution records.
///////////////////////////////////////////////////////////////////
