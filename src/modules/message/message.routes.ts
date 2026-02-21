import { Router, type Router as ExpressRouter } from "express";
import { createMessage, getMessagesByCase } from "./message.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router: ExpressRouter = Router();

/**
 * POST /
 * Validation is handled inside MessageService via Zod.
 * Idempotency is enforced at middleware level.
 */
router.post("/", idempotencyGuard, createMessage);

/**
 * GET /:tenantId/:caseId
 * Fetch messages for a specific tenant-scoped case.
 */
router.get("/:tenantId/:caseId", getMessagesByCase);

export default router;
