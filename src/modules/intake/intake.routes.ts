import { Router, type Router as ExpressRouter } from "express";
import {
  handleIntake,
  handleIntakeBootstrap,
  handleIntakeDelivery,
  handleIntakeFollowup,
  handleResolveLocation, // ✅ ADD
} from "./intake.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router: ExpressRouter = Router();

/**
 * BOOTSTRAP intake (creates Project + seeds PostWin)
 * POST /api/intake/bootstrap
 */
router.post("/bootstrap", idempotencyGuard, handleIntakeBootstrap);

/**
 * RECORD intake (legacy)
 * POST /api/intake
 */
router.post("/", idempotencyGuard, handleIntake);

/**
 * DELIVERY intake
 * POST /api/intake/delivery
 */
router.post("/delivery", idempotencyGuard, handleIntakeDelivery);

/**
 * FOLLOW-UP intake
 * POST /api/intake/followup
 */
router.post("/followup", idempotencyGuard, handleIntakeFollowup);

/**
 * RESOLVE LOCATION (GhanaPost → GPS)
 * POST /api/intake/resolve-location
 * Non-idempotent, non-ledgered
 */
router.get("/resolve-location", handleResolveLocation);

export default router;
