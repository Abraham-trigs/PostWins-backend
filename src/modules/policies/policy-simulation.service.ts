import { prisma } from "../../lib/prisma";
import { autoTaskAdvance } from "./auto-task.policy";
import { AUTO_TASK_ADVANCE } from "./ids";
import {
  PolicySimulationInput,
  PolicySimulationResult,
} from "./simulation.types";
import { TaskId } from "@prisma/client";

export class PolicySimulationService {
  async simulate(
    params: PolicySimulationInput,
  ): Promise<PolicySimulationResult[]> {
    const { tenantId, caseId, hypotheticalFacts } = params;

    const caseRow = await prisma.case.findFirst({
      where: { id: caseId, tenantId },
      select: {
        lifecycle: true,
        currentTaskDefinition: {
          select: { key: true },
        },
      },
    });

    if (!caseRow) {
      throw new Error("Case not found");
    }

    const currentTask: TaskId =
      (caseRow.currentTaskDefinition?.key as TaskId) ?? TaskId.START;

    const results: PolicySimulationResult[] = [];

    const taskResult = autoTaskAdvance({
      lifecycle: caseRow.lifecycle,
      currentTask,
      hasRoutingDecision: hypotheticalFacts.routingOutcome === "MATCHED",
      hasDeliveryRecorded: !!hypotheticalFacts.deliveryRecorded,
    });

    results.push({
      policyKey: AUTO_TASK_ADVANCE,
      version: "v1",
      wouldApply: taskResult.kind === "ADVANCE_TASK",
      effect:
        taskResult.kind === "ADVANCE_TASK"
          ? {
              kind: "ADVANCE_TASK",
              details: {
                from: currentTask,
                to: taskResult.to,
              },
            }
          : {
              kind: "NO_OP",
              details: {},
            },
      reason: taskResult.reason,
    });

    return results;
  }
}
