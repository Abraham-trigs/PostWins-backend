// apps/backend/src/modules/execution/startExecution.service.ts

import { prisma } from "@/lib/prisma";
import {
  Prisma,
  ActorKind,
  ExecutionStatus,
  LedgerEventType,
} from "@prisma/client";

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

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1️⃣ Validate case
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

    // 2️⃣ Idempotent read
    const existingExecution = await tx.execution.findUnique({
      where: { caseId },
    });

    if (existingExecution) {
      return existingExecution;
    }

    // 3️⃣ Create execution
    const execution = await tx.execution.create({
      data: {
        tenantId,
        caseId,
        status: ExecutionStatus.IN_PROGRESS,
        startedAt: new Date(),
        startedByUserId: actorUserId ?? null,
      },
    });

    // 4️⃣ Seed milestones (planned deliverables model)
    await tx.executionMilestone.createMany({
      data: [
        {
          executionId: execution.id,
          label: "Initial Delivery",
          description: "First operational delivery milestone",
          weight: 2,
        },
        {
          executionId: execution.id,
          label: "Follow-up Visit",
          description: "Follow-up impact check",
          weight: 1,
        },
        {
          executionId: execution.id,
          label: "Impact Confirmation",
          description: "Final verification milestone",
          weight: 2,
        },
      ],
    });

    // 5️⃣ Ledger commit (authoritative lifecycle signal)
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
