import { Router, type Router as ExpressRouter } from "express";
import { createMessage, getMessagesByCase } from "./message.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router: ExpressRouter = Router();

/**
 * POST /
 * - Auth enforced in controller
 * - Idempotency enforced at middleware
 */
router.post("/", createMessage);

/**
 * GET /:caseId
 * - Tenant derived from auth
 * - Prevents tenantId spoofing
 */
router.get("/:caseId", getMessagesByCase);

export default router;
