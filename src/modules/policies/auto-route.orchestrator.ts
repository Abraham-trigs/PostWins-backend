import { prisma } from "../../lib/prisma";
import { ActorKind, DecisionType } from "@prisma/client";
import { autoRouteBasic } from "./auto-route.policy";
import { AUTO_ROUTE_BASIC, AUTO_ROUTE_BASIC_VERSION } from "./ids";
import { PolicyEvaluationService } from "./policy-evaluation.service";
import { DecisionService } from "../decision/decision.service";
import { CaseNotFoundError } from "../cases/case.errors";

export class AutoRouteOrchestrator {
  private policyEval = new PolicyEvaluationService();
  private decisions = new DecisionService();

  async evaluateAndApply(params: {
    tenantId: string;
    caseId: string;
    apply: boolean;
  }) {
    const { tenantId, caseId, apply } = params;

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

    if (apply && result.kind === "PROPOSE_DECISION") {
      await this.decisions.applyDecision({
        tenantId,
        caseId,
        decisionType: result.decisionType,
        actorKind: ActorKind.SYSTEM,
        reason: result.reason,
        intentContext: {
          policyKey: AUTO_ROUTE_BASIC,
        },
      });
    }

    return result;
  }
}
