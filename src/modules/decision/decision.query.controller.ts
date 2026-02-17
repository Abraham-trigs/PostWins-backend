// src/modules/decision/decision.query.controller.ts
// Decision query controllers — explainability-safe and tenant-bound.

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

////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////

function parseDecisionType(value: string): DecisionType {
  if (!Object.values(DecisionType).includes(value as DecisionType)) {
    throw new Error(`Invalid decision type: ${value}`);
  }
  return value as DecisionType;
}

function getTenantId(req: Request): string {
  const tenantId = (req as any).tenantId;
  if (!tenantId) {
    throw new Error("Tenant context missing");
  }
  return tenantId;
}

function getParam(param: string | string[] | undefined, label: string): string {
  if (!param) throw new Error(`Missing route param: ${label}`);
  if (Array.isArray(param)) {
    if (param.length === 0) throw new Error(`Invalid route param: ${label}`);
    return param[0];
  }
  return param;
}

////////////////////////////////////////////////////////////////
// Controllers
////////////////////////////////////////////////////////////////

export const getAuthoritativeDecision = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const caseId = getParam(req.params.caseId, "caseId");
  const decisionTypeRaw = getParam(req.params.decisionType, "decisionType");

  const decision = await decisionQueryService.getAuthoritativeDecision({
    tenantId,
    caseId,
    decisionType: parseDecisionType(decisionTypeRaw),
  });

  return res.json({
    decision: decision ? redactDecision(decision, role) : null,
  });
};

export const getDecisionHistory = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const caseId = getParam(req.params.caseId, "caseId");
  const decisionTypeRaw = getParam(req.params.decisionType, "decisionType");

  const history = await decisionQueryService.getDecisionChain({
    tenantId,
    caseId,
    decisionType: parseDecisionType(decisionTypeRaw),
  });

  return res.json({
    history: history.map((d) => redactDecision(d, role)),
  });
};

export const explainLifecycle = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const caseId = getParam(req.params.caseId, "caseId");

  const explanation = await decisionQueryService.explainLifecycle({
    tenantId,
    caseId,
  });

  return res.json({
    lifecycle: explanation.lifecycle,
    ledgerDerivedLifecycle: explanation.ledgerDerivedLifecycle,
    drift: explanation.drift,
    causedByDecision: explanation.causedByDecision
      ? redactDecision(explanation.causedByDecision, role)
      : null,
  });
};

export const getLedgerTrail = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const caseId = getParam(req.params.caseId, "caseId");

  const ledger = await decisionQueryService.getLedgerTrail({
    tenantId,
    caseId,
  });

  return res.json({
    ledger: ledger.map((c) => redactLedgerCommit(c, role)),
  });
};

export const getRoutingCounterfactual = async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const role = resolveExplainabilityRole(req);

  const caseId = getParam(req.params.caseId, "caseId");

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
