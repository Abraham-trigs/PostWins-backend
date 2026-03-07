// apps/backend/src/modules/intake/intake.routes.ts
// Purpose: Route definitions for intake module after controller split

import { Router, type Router as ExpressRouter } from "express";

import { idempotencyGuard } from "@/middleware/idempotency.middleware";

import { handleIntakeBootstrap } from "./controllers/intake.bootstrap.controller";
import { handleIntakeDelivery } from "./controllers/intake.delivery.controller";
import { handleResolveLocation } from "./controllers/intake.location.controller";

////////////////////////////////////////////////////////////////
// Router
////////////////////////////////////////////////////////////////

const router: ExpressRouter = Router();

/**
 * Create case intake
 * Requires idempotency protection
 */
router.post("/bootstrap", idempotencyGuard, handleIntakeBootstrap);

/**
 * Record field delivery progress
 * Requires idempotency protection
 */
router.post("/delivery", idempotencyGuard, handleIntakeDelivery);

/**
 * Resolve GhanaPost location code
 */
router.get("/resolve-location", handleResolveLocation);

export default router;

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Routes now map cleanly to separate controllers after the intake
// controller split. This keeps the routing layer simple and makes
// each endpoint independently testable.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// POST /bootstrap         -> handleIntakeBootstrap
// POST /delivery          -> handleIntakeDelivery
// GET  /resolve-location  -> handleResolveLocation

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Ensure this router is mounted in app.ts or server.ts:
//
// app.use("/intake", intakeRouter)

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// As intake grows (attachments, questionnaire submissions,
// beneficiary verification), new controllers can be added
// without inflating this router or reintroducing monolithic
// controllers.
