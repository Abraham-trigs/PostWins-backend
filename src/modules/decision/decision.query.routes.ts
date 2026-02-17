import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import {
  getAuthoritativeDecision,
  getDecisionHistory,
  explainLifecycle,
  getLedgerTrail,
  getRoutingCounterfactual,
} from "./decision.query.controller";
import { requireTenantId } from "../../middleware/requireTenantId";
import { requireInternalAccess } from "../../middleware/requireInternalAccess";

const router: ExpressRouter = Router();
// 🔒 Phase 5.1: tenant-scoped + internal-only audit access
router.use(requireTenantId);
router.use(requireInternalAccess);

// Decisions
router.get("/cases/:caseId/decisions/:decisionType", getAuthoritativeDecision);

router.get(
  "/cases/:caseId/decisions/:decisionType/history",
  getDecisionHistory,
);

// Lifecycle
router.get("/cases/:caseId/lifecycle/explain", explainLifecycle);

// Ledger
router.get("/cases/:caseId/ledger", getLedgerTrail);

// Counterfactuals
router.get("/cases/:caseId/routing/counterfactual", getRoutingCounterfactual);

export default router;
