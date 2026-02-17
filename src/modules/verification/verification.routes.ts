// filepath: apps/backend/src/modules/verification/verification.routes.ts
// Purpose: Verification API routes aligned with verification.controller exports

import { Router, type Router as ExpressRouter } from "express";
import {
  getVerificationRecord,
  submitVerificationVote,
} from "./verification.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router: ExpressRouter = Router();

/**
 * GET /api/verification/:verificationRecordId
 * Fetch verification record (read-only)
 */
router.get("/:verificationRecordId", getVerificationRecord);

/**
 * POST /api/verification/vote
 * Submit verification vote
 */
router.post("/vote", idempotencyGuard, submitVerificationVote);

export default router;

/*
Design reasoning
----------------
Routes must mirror controller exports exactly.
Controller defines:
- getVerificationRecord
- submitVerificationVote

Route naming now reflects VerificationRecord as the authoritative entity,
not PostWin.

Structure
---------
GET    /api/verification/:verificationRecordId
POST   /api/verification/vote

Implementation guidance
-----------------------
Ensure app.ts mounts as:
app.use("/api/verification", verificationRouter);

Client must send:
{
  verificationRecordId,
  verifierUserId,
  status: "APPROVED" | "REJECTED",
  note?
}

Scalability insight
-------------------
- VerificationRecord is governance authority boundary.
- Routes do not expose lifecycle mutation.
- Idempotency guard protects duplicate vote submissions.
- API surface now matches sovereign Phase 1.5 architecture.
*/
