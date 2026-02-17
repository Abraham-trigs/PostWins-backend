import { prisma } from "../../lib/prisma";
import { autoTaskAdvance } from "./auto-task.policy";
import { AUTO_TASK_ADVANCE } from "./ids";
import {
  PolicySimulationInput,
  PolicySimulationResult,
} from "./simulation.types";

export class PolicySimulationService {
  async simulate(
    params: PolicySimulationInput,
  ): Promise<PolicySimulationResult[]> {
    const { tenantId, caseId, hypotheticalFacts } = params;

    const caseRow = await prisma.case.findFirst({
      where: { id: caseId, tenantId },
      select: {
        lifecycle: true,
        currentTask: true,
      },
    });

    if (!caseRow) {
      throw new Error("Case not found");
    }

    const results: PolicySimulationResult[] = [];

    /**
     * 🔮 Simulation: Auto-task advancement
     * Reuses the same pure policy logic as production.
     * Hypothetical facts override absence, not reality.
     */
    const taskResult = autoTaskAdvance({
      lifecycle: caseRow.lifecycle,
      currentTask: caseRow.currentTask,
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
                from: caseRow.currentTask,
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
