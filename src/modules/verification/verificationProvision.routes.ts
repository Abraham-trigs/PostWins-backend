// filepath: apps/backend/src/modules/verification/verificationProvision.routes.ts
// Purpose: Governance-gated verifier provisioning routes aligned with verificationProvision.controller exports

import { Router, type Router as ExpressRouter } from "express";
import { proposeVerifierProvision } from "./verificationProvision.controller";

const router: ExpressRouter = Router();

/**
 * POST /api/verification-provision/cases/:caseId/propose-verifier
 * Propose governance-gated verifier provisioning
 */
router.post("/cases/:caseId/propose-verifier", proposeVerifierProvision);

export default router;

/*
Design reasoning
----------------
Routes must mirror controller exports exactly.
Controller defines:
- proposeVerifierProvision

Provisioning is governance-gated and does NOT create users directly.
Route reflects proposal action, not execution.

Structure
---------
POST   /api/verification-provision/cases/:caseId/propose-verifier

Implementation guidance
-----------------------
Ensure app.ts mounts as:
app.use("/api/verification-provision", verificationProvisionRouter);

Client must send:
{
  email: string,
  roleKey: string,
  reason: string (min 5 chars)
}

Auth middleware must populate:
req.user = { tenantId, userId, ... }

Scalability insight
-------------------
- Provisioning remains proposal-driven, not imperative.
- No lifecycle mutation exposed here.
- Execution remains centralized in orchestrator.
- API boundary preserves governance-first architecture.
*/
