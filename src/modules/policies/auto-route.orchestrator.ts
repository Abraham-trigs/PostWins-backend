import { prisma } from "../../lib/prisma";
import { DecisionType } from "@prisma/client";
import { autoRouteBasic } from "./auto-route.policy";
import { AUTO_ROUTE_BASIC, AUTO_ROUTE_BASIC_VERSION } from "./ids";
import { PolicyEvaluationService } from "./policy-evaluation.service";
import { ApprovalGateService } from "../approvals/approval-gate.service";
import { CaseNotFoundError } from "../cases/case.errors";

export class AutoRouteOrchestrator {
  private policyEval = new PolicyEvaluationService();
  private approvalGate = new ApprovalGateService();

  async evaluateAndApply(params: {
    tenantId: string;
    caseId: string;
    apply: boolean;
  }) {
    const { tenantId, caseId } = params;

    const [caseRow, routingCount, executionBodies] = await Promise.all([
      prisma.case.findFirst({
        where: { id: caseId, tenantId },
        select: { lifecycle: true },
      }),
      prisma.decision.count({
        where: {
          tenantId,
          caseId,
          decisionType: DecisionType.ROUTING,
          supersededAt: null,
        },
      }),
      prisma.executionBody.count({
        where: { tenantId, isFallback: false },
      }),
    ]);

    if (!caseRow) throw new CaseNotFoundError(caseId);

    const result = autoRouteBasic({
      lifecycle: caseRow.lifecycle,
      hasRoutingDecision: routingCount > 0,
      executionBodiesAvailable: executionBodies,
    });

    await this.policyEval.record({
      tenantId,
      caseId,
      policyKey: AUTO_ROUTE_BASIC,
      version: AUTO_ROUTE_BASIC_VERSION,
      result,
    });

    // Only PROPOSE_DECISION carries actionable authority
    if (result.kind === "PROPOSE_DECISION") {
      const executionBody = await prisma.executionBody.findFirst({
        where: { tenantId, isFallback: false },
        select: { id: true },
      });

      if (!executionBody) {
        // Defensive guard — policy should prevent this
        throw new Error("Execution body not found");
      }

      await this.approvalGate.propose({
        tenantId,
        caseId,
        policyKey: AUTO_ROUTE_BASIC,
        effect: {
          kind: "ROUTE_CASE",
          payload: {
            executionBodyId: executionBody.id,
          },
        },
        reason: result.reason,
      });
    }

    return result;
  }
}
