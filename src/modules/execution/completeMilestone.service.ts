import { prisma } from "@/lib/prisma";
import {
  Prisma,
  LedgerEventType,
  ActorKind,
  ExecutionStatus,
} from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { InvariantViolationError } from "@/modules/cases/case.errors";

type CompleteMilestoneInput = {
  tenantId: string;
  milestoneId: string;
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
};

export class CompleteMilestoneService {
  async complete(input: CompleteMilestoneInput) {
    const { tenantId, milestoneId, actorUserId, idempotencyKey, requestHash } =
      input;

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const milestone = await tx.executionMilestone.findUnique({
        where: { id: milestoneId },
        include: { execution: true },
      });

      if (!milestone) {
        throw new InvariantViolationError("MILESTONE_NOT_FOUND");
      }

      // 🔒 Tenant boundary enforcement
      if (milestone.execution.tenantId !== tenantId) {
        throw new InvariantViolationError("TENANT_MISMATCH");
      }

      // 🔒 Execution must be in progress
      if (milestone.execution.status !== ExecutionStatus.IN_PROGRESS) {
        throw new InvariantViolationError("EXECUTION_NOT_ACTIVE");
      }

      // ♻️ Idempotent completion
      if (milestone.completedAt) {
        return milestone;
      }

      const now = new Date();

      const updatedMilestone = await tx.executionMilestone.update({
        where: { id: milestoneId },
        data: {
          completedAt: now,
          completedByUserId: actorUserId,
        },
      });

      // 📜 Ledger commit (authoritative progress record)
      await commitLedgerEvent(
        {
          tenantId,
          caseId: milestone.execution.caseId,
          eventType: LedgerEventType.EXECUTION_PROGRESS_RECORDED,
          actor: {
            kind: ActorKind.HUMAN,
            userId: actorUserId,
            authorityProof: `HUMAN:${actorUserId}:${idempotencyKey}:${requestHash}`,
          },
          intentContext: {
            milestoneId,
          },
          payload: {
            milestoneId,
            executionId: milestone.executionId,
            completedAt: now.toISOString(),
          },
        },
        tx,
      );

      return updatedMilestone;
    });
  }
}
