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

// POST /api/auth/request-login
router.post("/request-login", requestLogin);

// POST /api/auth/verify
router.post("/verify", verifyLogin);

// POST /api/auth/refresh
router.post("/refresh", refreshSession);

//POST /api/auth/logout
router.post("/logout", logout);

router.get("/me", getCurrentUser);

export default router;
