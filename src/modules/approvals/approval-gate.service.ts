import { prisma } from "@/lib/prisma";
import { GatedEffect } from "./approval.types";
import { ApprovalStatus } from "@prisma/client";
import { z } from "zod";

const ProposeApprovalSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  policyKey: z.string().min(1),
  effect: z.custom<GatedEffect>(),
  reason: z.string().min(5),
});

export class ApprovalGateService {
  /**
   * Propose a governance-gated action.
   * Does NOT mutate lifecycle.
   * Does NOT commit ledger.
   * Only records intent.
   */
  async propose(input: unknown) {
    const params = ProposeApprovalSchema.parse(input);

    return prisma.approvalRequest.create({
      data: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        policyKey: params.policyKey,
        effect: params.effect,
        reason: params.reason,
        status: ApprovalStatus.PENDING,
      },
    });
  }

  /**
   * Approve request.
   * Does NOT execute effect.
   * Execution must occur in separate orchestrator.
   */
  async approve(approvalRequestId: string) {
    return prisma.approvalRequest.update({
      where: { id: approvalRequestId },
      data: { status: ApprovalStatus.APPROVED },
    });
  }

  /**
   * Reject request.
   */
  async reject(approvalRequestId: string) {
    return prisma.approvalRequest.update({
      where: { id: approvalRequestId },
      data: { status: ApprovalStatus.REJECTED },
    });
  }
}
