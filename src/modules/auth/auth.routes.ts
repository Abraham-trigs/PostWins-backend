// apps/backend/src/modules/auth/auth.routes.ts
// Purpose: Public authentication routes (mounted before authMiddleware)

import {
  requestLogin,
  verifyLogin,
  logout,
  getCurrentUser,
} from "./auth.controller";
import { refreshSession } from "./auth.controller";
import { Router, type Router as ExpressRouter } from "express";
import { proposeVerifierProvision } from "./provision-verifier.controller";

/**
 * Design reasoning:
 * - Auth routes must be public (no authMiddleware).
 * - Mounted under /api/auth.
 * - Minimal surface: only login initiation for now.
 *
 * Structure:
 * - POST /request-login
 *
 * Implementation guidance:
 * - Mount BEFORE authMiddleware in app.ts
 * - Future routes: /verify, /refresh, /logout
 *
 * Scalability insight:
 * - Easy to extend with rate limiting middleware.
 * - Can attach IP throttling here.
 */

const router: ExpressRouter = Router();

// 1. Authentication initiation
router.post("/request-login", requestLogin);

// 2. Authentication verification
router.post("/verify", verifyLogin);

// 3. Session refresh
router.post("/refresh", refreshSession);

// 4. Session termination
router.post("/logout", logout);

// 5. Identity introspection
// router.get("/me", getCurrentUser);

// 6. Governance-triggered identity provisioning
router.post("/provision-verifier", proposeVerifierProvision);

export default router;
