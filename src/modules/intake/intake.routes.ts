import { Router } from "express";
import {
  handleIntakeDelivery,
  handleIntakeFollowup,
} from "./intake.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router = Router();

/**
 * DELIVERY intake
 * Idempotent by design (offline-first safe)
 * POST /api/intake/delivery
 */
router.post("/delivery", idempotencyGuard, handleIntakeDelivery);

/**
 * FOLLOW-UP intake
 * Idempotent by design (offline-first safe)
 * POST /api/intake/followup
 */
router.post("/followup", idempotencyGuard, handleIntakeFollowup);

/**
 * (Optional legacy endpoint)
 * Keep ONLY if something already depends on POST /api/intake
 * Otherwise, delete this after migration.
 */
// router.post("/", handleIntake);

export default router;
