import { Request, Response } from "express";
import { DecisionType } from "@prisma/client";
import { DecisionQueryService } from "./decision.query.service";

const decisionQueryService = new DecisionQueryService();

/**
 * Runtime-safe DecisionType parsing.
 */
function parseDecisionType(value: string): DecisionType {
  if (!Object.values(DecisionType).includes(value as DecisionType)) {
    throw new Error(`Invalid decision type: ${value}`);
  }
  return value as DecisionType;
}

/**
 * Helper to read tenantId injected by requireTenantId middleware.
 */
function getTenantId(req: Request): string {
  const tenantId = (req as any).tenantId;
  if (!tenantId) {
    throw new Error("Tenant context missing");
  }
  return tenantId;
}

/**
 * GET /api/cases/:caseId/decisions/:decisionType
 * What decision currently governs this case for X?
 */
export const getAuthoritativeDecision = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const { caseId, decisionType } = req.params;

  const decision = await decisionQueryService.getAuthoritativeDecision({
    tenantId,
    caseId,
    decisionType: parseDecisionType(decisionType),
  });

  return res.json({ decision });
};

/**
 * GET /api/cases/:caseId/decisions/:decisionType/history
 * How did we get here?
 */
export const getDecisionHistory = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const { caseId, decisionType } = req.params;

  const history = await decisionQueryService.getDecisionChain({
    tenantId,
    caseId,
    decisionType: parseDecisionType(decisionType),
  });

  return res.json({ history });
};

/**
 * GET /api/cases/:caseId/lifecycle/explain
 * Why is the case in this lifecycle?
 */
export const explainLifecycle = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const { caseId } = req.params;

  const explanation = await decisionQueryService.explainLifecycle({
    tenantId,
    caseId,
  });

  return res.json(explanation);
};

/**
 * GET /api/cases/:caseId/ledger
 * What immutable facts were recorded?
 */
export const getLedgerTrail = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const { caseId } = req.params;

  const ledger = await decisionQueryService.getLedgerTrail({
    tenantId,
    caseId,
  });

  return res.json({ ledger });
};

/**
 * GET /api/cases/:caseId/routing/counterfactual
 * What alternatives were considered?
 */
export const getRoutingCounterfactual = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const { caseId } = req.params;

  const counterfactual = await decisionQueryService.getRoutingCounterfactual({
    tenantId,
    caseId,
  });

  return res.json({ counterfactual });
};
