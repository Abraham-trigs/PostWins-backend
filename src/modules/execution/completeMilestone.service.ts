import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { LedgerEventType, ActorKind } from "@prisma/client";

const ledger = new LedgerService();

export class CompleteMilestoneService {
  async complete(
    tenantId: string,
    milestoneId: string,
    actorUserId: string,
    idempotencyKey: string,
    requestHash: string,
  ) {
    const milestone = await prisma.executionMilestone.findUnique({
      where: { id: milestoneId },
      include: { execution: true },
    });

    if (!milestone) {
      throw new Error("Milestone not found");
    }

    if (milestone.completedAt) {
      return milestone; // idempotent completion
    }

    const now = new Date();

    await prisma.executionMilestone.update({
      where: { id: milestoneId },
      data: {
        completedAt: now,
        completedByUserId: actorUserId,
      },
    });

    await ledger.appendEntry({
      tenantId,
      caseId: milestone.execution.caseId,
      eventType: LedgerEventType.EXECUTION_PROGRESS_RECORDED,
      actorKind: ActorKind.HUMAN,
      actorUserId,
      authorityProof: `HUMAN:${actorUserId}:${idempotencyKey}:${requestHash}`,
      payload: {
        milestoneId,
        executionId: milestone.executionId,
        completedAt: now.toISOString(),
      },
    });
  }
}
