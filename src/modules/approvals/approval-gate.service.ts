import { prisma } from "../../lib/prisma";
import { GatedEffect } from "./approval.types";
import { ApprovalStatus } from "@prisma/client";

export class ApprovalGateService {
  async propose(params: {
    tenantId: string;
    caseId: string;
    policyKey: string;
    effect: GatedEffect;
    reason: string;
  }) {
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
}
