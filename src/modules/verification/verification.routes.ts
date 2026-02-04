// apps/backend/src/modules/verification/verification.routes.ts
import { Router, type Router as ExpressRouter } from "express";
import { getPostWin, verifyPostWin } from "./verification.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router: ExpressRouter = Router();

/**
 * GET /api/verification/:postWinId
 */
router.get("/postwin/:postWinId", getPostWin);
/**
 * POST /api/verification/verify
 */
router.post("/verify", idempotencyGuard, verifyPostWin);
export default router;
