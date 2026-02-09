import { prisma } from "../../lib/prisma";
import { autoTaskAdvance } from "./auto-task.policy";
import { AUTO_TASK_ADVANCE } from "./ids";
import { PolicyEvaluationService } from "./policy-evaluation.service";
import { ApprovalGateService } from "../approvals/approval-gate.service";
import { CaseNotFoundError } from "../cases/case.errors";

export class AutoTaskOrchestrator {
  private policyEval = new PolicyEvaluationService();
  private approvalGate = new ApprovalGateService();

  async evaluateAndApply(params: {
    tenantId: string;
    caseId: string;
    apply: boolean; // retained for interface compatibility; not authoritative
  }) {
    const { tenantId, caseId } = params;

    const [caseRow, routingDecisionCount, deliveryCount] = await Promise.all([
      prisma.case.findFirst({
        where: { id: caseId, tenantId },
        select: {
          lifecycle: true,
          currentTask: true,
        },
      }),
      prisma.decision.count({
        where: {
          tenantId,
          caseId,
          decisionType: "ROUTING",
          supersededAt: null,
        },
      }),
      prisma.timelineEntry.count({
        where: {
          tenantId,
          caseId,
          type: "DELIVERY",
        },
      }),
    ]);

    if (!caseRow) throw new CaseNotFoundError();

    const hasRoutingDecision = routingDecisionCount > 0;
    const hasDeliveryRecorded = deliveryCount > 0;

    const result = autoTaskAdvance({
      lifecycle: caseRow.lifecycle,
      currentTask: caseRow.currentTask,
      hasRoutingDecision,
      hasDeliveryRecorded,
    });

    await this.policyEval.record({
      tenantId,
      caseId,
      policyKey: AUTO_TASK_ADVANCE,
      version: "v1",
      result,
      context: {
        lifecycle: caseRow.lifecycle,
        currentTask: caseRow.currentTask,
        hasRoutingDecision,
        hasDeliveryRecorded,
      },
    });

    /**
     * 🔐 Task advancement is an authoritative state transition.
     * Policy decides WHAT. Gate decides WHETHER.
     */
    if (result.kind === "ADVANCE_TASK") {
      await this.approvalGate.propose({
        tenantId,
        caseId,
        policyKey: AUTO_TASK_ADVANCE,
        effect: {
          kind: "ADVANCE_TASK",
          payload: {
            from: caseRow.currentTask,
            to: result.to,
          },
        },
        reason: result.reason,
      });
    }

    return result;
  }
}
