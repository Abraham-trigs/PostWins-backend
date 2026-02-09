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
    apply: boolean; // retained for interface compatibility; no longer authoritative
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

    if (!caseRow) throw new CaseNotFoundError();

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

    // 🔐 Phase 6.4 — Human approval gate
    if (result.kind === "PROPOSE_DECISION") {
      await this.approvalGate.propose({
        tenantId,
        caseId,
        policyKey: AUTO_ROUTE_BASIC,
        effect: {
          kind: "ROUTE_CASE",
          payload: {
            // policy decides WHAT, human decides WHETHER
            executionBodyId: result.executionBodyId,
          },
        },
        reason: result.reason,
      });
    }

    return result;
  }
}
