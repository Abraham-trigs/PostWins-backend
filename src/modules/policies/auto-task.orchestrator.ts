import { prisma } from "../../lib/prisma";
import { autoTaskAdvance } from "./auto-task.policy";
import { AUTO_TASK_ADVANCE } from "./ids";
import { PolicyEvaluationService } from "./policy-evaluation.service";

export class AutoTaskOrchestrator {
  private policyEval = new PolicyEvaluationService();

  async evaluateAndApply(params: {
    tenantId: string;
    caseId: string;
    apply: boolean; // explicit opt-in
  }) {
    const { tenantId, caseId, apply } = params;

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

    if (!caseRow) {
      throw new Error("Case not found");
    }

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

    if (
      apply &&
      result.kind === "ADVANCE_TASK" &&
      caseRow.currentTask !== result.to
    ) {
      await prisma.case.update({
        where: { id: caseId },
        data: {
          currentTask: result.to,
        },
      });
    }

    return result;
  }
}
