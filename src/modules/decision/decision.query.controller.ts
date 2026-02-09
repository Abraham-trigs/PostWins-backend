import { Request, Response } from "express";
import { DecisionType } from "@prisma/client";
import { DecisionQueryService } from "./decision.query.service";

import { resolveExplainabilityRole } from "../../middleware/resolveExplainabilityRole";
import {
  redactDecision,
  redactLedgerCommit,
  redactCounterfactual,
  allowCounterfactuals,
} from "../explainability/explainability.redaction";

const decisionQueryService = new DecisionQueryService();

/**
 * Runtime-safe DecisionType parsing.
 * Guards against enum drift and malformed routes.
 */
function parseDecisionType(value: string): DecisionType {
  if (!Object.values(DecisionType).includes(value as DecisionType)) {
    throw new Error(`Invalid decision type: ${value}`);
  }
  return value as DecisionType;
}

/**
 * Helper to read tenantId injected by requireTenantId middleware.
 * Fail-fast to avoid cross-tenant leakage.
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
 * What decision currently governs this case?
 */
export const getAuthoritativeDecision = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const { caseId, decisionType } = req.params;

  const decision = await decisionQueryService.getAuthoritativeDecision({
    tenantId,
    caseId,
    decisionType: parseDecisionType(decisionType),
  });

  return res.json({
    decision: decision ? redactDecision(decision, role) : null,
  });
};

/**
 * GET /api/cases/:caseId/decisions/:decisionType/history
 * How did we get here?
 */
export const getDecisionHistory = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const { caseId, decisionType } = req.params;

  const history = await decisionQueryService.getDecisionChain({
    tenantId,
    caseId,
    decisionType: parseDecisionType(decisionType),
  });

  return res.json({
    history: history.map((d) => redactDecision(d, role)),
  });
};

/**
 * GET /api/cases/:caseId/lifecycle/explain
 * Why is the case in this lifecycle?
 *
 * NOTE:
 * explanation.decisions MUST be full Decision records.
 * Do not return derived or partial projections here.
 */
export const explainLifecycle = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const { caseId } = req.params;

  const explanation = await decisionQueryService.explainLifecycle({
    tenantId,
    caseId,
  });

  return res.json({
    ...explanation,
    decisions: explanation.decisions.map((d) => redactDecision(d, role)),
  });
};

/**
 * GET /api/cases/:caseId/ledger
 * What immutable facts were recorded?
 */
export const getLedgerTrail = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const { caseId } = req.params;

  const ledger = await decisionQueryService.getLedgerTrail({
    tenantId,
    caseId,
  });

  return res.json({
    ledger: ledger.map((c) => redactLedgerCommit(c, role)),
  });
};

/**
 * GET /api/cases/:caseId/routing/counterfactual
 * What alternatives were considered?
 *
 * HARD GATE:
 * If role is not allowed, do not return structure,
 * metadata, or hints.
 */
export const getRoutingCounterfactual = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const { caseId } = req.params;

  // ✅ Counterfactual handling — correct and intentional
  if (!allowCounterfactuals(role)) {
    return res.json({ counterfactual: null });
  }

  const counterfactual = await decisionQueryService.getRoutingCounterfactual({
    tenantId,
    caseId,
  });

  return res.json({
    counterfactual: counterfactual
      ? redactCounterfactual(counterfactual, role)
      : null,
  });
};
