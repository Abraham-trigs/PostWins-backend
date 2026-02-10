import { prisma } from "../../lib/prisma";
import { DecisionService } from "../decision/decision.service";
import { ActorKind, ApprovalStatus } from "@prisma/client";

export class ApprovalResolutionService {
  private decisionService = new DecisionService();

  async approve(params: {
    tenantId: string;
    approvalId: string;
    actorUserId: string;
  }) {
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        id: params.approvalId,
        tenantId: params.tenantId,
        status: ApprovalStatus.PENDING,
      },
    });

    if (!approval) {
      throw new Error("Approval request not found or already resolved");
    }

    await prisma.$transaction(async (tx) => {
      await tx.approvalRequest.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatus.APPROVED,
          resolvedAt: new Date(),
          resolvedByUserId: params.actorUserId,
        },
      });

      // 🔑 ONLY place authority is exercised
      await this.decisionService.applyDecision(
        {
          tenantId: approval.tenantId,
          caseId: approval.caseId,
          decisionType: "ROUTING", // example – resolved by effect.kind
          actorKind: ActorKind.HUMAN,
          actorUserId: params.actorUserId,
          reason: approval.reason,
          intentContext: {
            approvalId: approval.id,
            policyKey: approval.policyKey,
            effect: approval.effect,
          },
        },
        tx,
      );
    });
  }

  async reject(params: {
    tenantId: string;
    approvalId: string;
    actorUserId: string;
    reason?: string;
  }) {
    const approval = await prisma.approvalRequest.findFirst({
      where: {
        id: params.approvalId,
        tenantId: params.tenantId,
        status: ApprovalStatus.PENDING,
      },
    });

    if (!approval) {
      throw new Error("Approval request not found or already resolved");
    }

    await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: ApprovalStatus.REJECTED,
        resolvedAt: new Date(),
        resolvedByUserId: params.actorUserId,
      },
    });
  }
}
