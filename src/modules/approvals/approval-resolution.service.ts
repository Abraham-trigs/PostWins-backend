// apps/backend/src/modules/approvals/approval-resolution.service.ts
// Purpose: Resolve approval requests and execute authoritative decision effects when approved.

import { prisma } from "@/lib/prisma";
import {
  ApprovalStatus,
  Prisma,
  ActorKind,
  DecisionType,
} from "@prisma/client";
import { DecisionService } from "../decision/decision.service";
import { InvariantViolationError } from "../cases/case.errors";

/**
 * Design reasoning:
 * - Approval resolution is authoritative.
 * - Approval does not mutate lifecycle directly.
 * - DecisionService executes effect consistently.
 * - Transaction guarantees atomicity.
 *
 * Structure:
 * - resolve(): validates request, updates status,
 *   delegates effect execution via DecisionService.
 *
 * Implementation guidance:
 * - Instantiate with injected DecisionService.
 * - Never execute effects directly here.
 *
 * Scalability insight:
 * - effect payload remains policy-driven.
 * - DecisionType.APPROVAL keeps governance explicit.
 */
type ResolveApprovalParams = {
  approvalRequestId: string;
  actorUserId: string;
  approved: boolean;
  note?: string;
};

export class ApprovalResolutionService {
  constructor(private decisionService: DecisionService) {}

  async resolve(params: ResolveApprovalParams) {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Load request
      ////////////////////////////////////////////////////////////////

      const request = await tx.approvalRequest.findUnique({
        where: { id: params.approvalRequestId },
      });

      if (!request) {
        throw new InvariantViolationError("APPROVAL_REQUEST_NOT_FOUND");
      }

      if (request.status !== ApprovalStatus.PENDING) {
        throw new InvariantViolationError("APPROVAL_ALREADY_RESOLVED");
      }

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Update approval status
      ////////////////////////////////////////////////////////////////

      const newStatus = params.approved
        ? ApprovalStatus.APPROVED
        : ApprovalStatus.REJECTED;

      const updated = await tx.approvalRequest.update({
        where: { id: request.id },
        data: {
          status: newStatus,
          resolvedByUserId: params.actorUserId,
          resolvedAt: new Date(),
          reason: params.note,
        },
      });

      ////////////////////////////////////////////////////////////////
      // 3️⃣ If approved → execute authoritative decision
      ////////////////////////////////////////////////////////////////

      if (params.approved) {
        await this.decisionService.applyDecision(
          {
            tenantId: request.tenantId,
            caseId: request.caseId,
            decisionType: DecisionType.BUDGET, // ← pick correct domain type
            actorKind: ActorKind.HUMAN,
            actorUserId: params.actorUserId,
            reason: params.note,
            intentContext: {
              approvalRequestId: request.id,
              policyKey: request.policyKey,
            },
            effect: request.effect as any,
          },
          tx,
        );
      }

      return updated;
    });
  }
}
