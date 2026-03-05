// apps/backend/src/modules/cases/cases.routes.ts
// Purpose: Case routing configuration (list + details + explain) with JWT-derived tenant isolation.

import { Router, type Router as ExpressRouter } from "express";
import { listCases } from "./cases.controller";
import { getCaseDetails } from "./cases.details.controller";
import { explainCaseController } from "./explain.case.Controller";
import { resolveExplainabilityRole } from "../../middleware/resolveExplainabilityRole";
import { handleManualRoute } from "../routing/routing.controller";
/**
 * ============================================================
 * Assumptions
 * ------------------------------------------------------------
 * - Global auth middleware already attaches req.user
 *   containing { userId, tenantId, role }.
 * - Tenant isolation is enforced via req.user.tenantId.
 * - requireTenantId middleware is deprecated (header-based).
 * - getCaseDetails enforces tenant isolation internally.
 * ============================================================
 */

export const casesRouter: ExpressRouter = Router();

////////////////////////////////////////////////////////////////
// Manual Casse Routing
////////////////////////////////////////////////////////////////

casesRouter.post("/:caseId/route", handleManualRoute);

////////////////////////////////////////////////////////////////
// List (tenant derived from JWT)
////////////////////////////////////////////////////////////////

casesRouter.get("/", listCases);

////////////////////////////////////////////////////////////////
// Details (authoritative single case view)
////////////////////////////////////////////////////////////////

casesRouter.get("/:id", getCaseDetails);

////////////////////////////////////////////////////////////////
// Explainability (governed endpoint)
////////////////////////////////////////////////////////////////

casesRouter.post("/explain", resolveExplainabilityRole, explainCaseController);

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Removed requireTenantId (header-based) to prevent tenant spoofing.
// - All tenant derivation comes from JWT middleware.
// - Clear separation:
//     GET /cases            → list
//     GET /cases/:id        → authoritative details
//     POST /cases/explain   → governance/explainability
// - Order matters: "/:id" must not shadow "/explain".

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - GET / → listCases
// - GET /:id → getCaseDetails
// - POST /explain → explainCaseController

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Ensure this router is mounted in app.ts as:
// app.use("/cases", casesRouter);
//
// Ensure auth middleware runs before router:
// app.use(authMiddleware);

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Keep read endpoints idempotent and projection-focused.
// As timeline/ledger expand, move heavy loads into modular services
// instead of bloating this router layer.
////////////////////////////////////////////////////////////////
