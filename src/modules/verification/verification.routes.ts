// filepath: apps/backend/src/modules/verification/verification.routes.ts
// Purpose: Verification API routes aligned with verification.controller exports (request + vote + read).

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Routes must mirror controller exports exactly and keep POST endpoints idempotent.
// Verification is governance-critical; duplicate submissions must be prevented.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// GET  /api/verification/:verificationRecordId
// POST /api/verification/vote
// POST /api/verification/request

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Mount in app.ts as:
// app.use("/api/verification", verificationRouter);

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Adding more endpoints (e.g., list by caseId, list pending for verifier) can be done without breaking existing routes.

import { Router, type Router as ExpressRouter } from "express";
import {
  getVerificationRecord,
  submitVerificationVote,
  requestVerification,
} from "./verification.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router: ExpressRouter = Router();

router.get("/:verificationRecordId", getVerificationRecord);

router.post("/vote", idempotencyGuard, submitVerificationVote);

router.post("/request", idempotencyGuard, requestVerification);

export default router;
