// filepath: apps/backend/src/modules/disbursement/disbursement.routes.ts
import { Router, type Router as ExpressRouter } from "express";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

import {
  listDisbursements,
  getDisbursementById,
  authorizeDisbursementHandler,
  executeDisbursementHandler,
} from "./disbursement.controller";

const router: ExpressRouter = Router();

router.get("/", listDisbursements);
router.get("/:id", getDisbursementById);

router.post("/authorize", idempotencyGuard, authorizeDisbursementHandler);
router.post("/execute", idempotencyGuard, executeDisbursementHandler);

export default router;
