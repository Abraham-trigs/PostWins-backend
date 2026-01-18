import { Router } from "express";
import {
  handleIntake,
  handleIntakeBootstrap,
  handleIntakeDelivery,
  handleIntakeFollowup,
} from "./intake.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router = Router();

/**
 * BOOTSTRAP intake (creates Project + seeds PostWin)
 * Idempotent by design (offline-first safe)
 * POST /api/intake/bootstrap
 */
router.post("/bootstrap", idempotencyGuard, handleIntakeBootstrap);

/**
 * RECORD intake (creates PostWin container - legacy)
 * Idempotent by design (offline-first safe)
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

export default router;
