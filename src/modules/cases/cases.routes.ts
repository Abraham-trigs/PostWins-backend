import { Router, type Router as ExpressRouter } from "express";
import { listCases } from "./cases.controller";
import { explainCaseController } from "./explain.case.Controller";
import { requireTenantId } from "../../middleware/requireTenantId";
import { resolveExplainabilityRole } from "../../middleware/resolveExplainabilityRole";

export const casesRouter: ExpressRouter = Router();

casesRouter.get("/", listCases);

// Phase 5.7 — canonical explain endpoint
casesRouter.post(
  "/explain",
  requireTenantId,
  resolveExplainabilityRole,
  explainCaseController,
);
