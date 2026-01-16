"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const intake_controller_1 = require("./intake.controller");
const idempotency_middleware_1 = require("../../middleware/idempotency.middleware");
const router = (0, express_1.Router)();
/**
 * DELIVERY intake
 * Idempotent by design (offline-first safe)
 * POST /api/intake/delivery
 */
router.post("/delivery", idempotency_middleware_1.idempotencyGuard, intake_controller_1.handleIntakeDelivery);
/**
 * FOLLOW-UP intake
 * Idempotent by design (offline-first safe)
 * POST /api/intake/followup
 */
router.post("/followup", idempotency_middleware_1.idempotencyGuard, intake_controller_1.handleIntakeFollowup);
/**
 * (Optional legacy endpoint)
 * Keep ONLY if something already depends on POST /api/intake
 * Otherwise, delete this after migration.
 */
// router.post("/", handleIntake);
exports.default = router;
