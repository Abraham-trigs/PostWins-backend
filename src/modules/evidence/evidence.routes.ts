// apps/backend/src/modules/evidence/evidence.routes.ts
// Purpose: Multi-tenant routes for NGO Evidence
// (Presign + Commit + Secure Download + Paginated Listing).

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Auth required for all endpoints.
// - Clean REST separation:
//   POST   /presign
//   POST   /commit
//   GET    /           (paginated listing)
//   GET    /:id/download
// - Prevents mixing metadata and file access.
// - Scalable for audit logging + RBAC extension.

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import { Router, type Router as ExpressRouter } from "express";
import {
  presignEvidence,
  commitEvidence,
  downloadEvidence,
  listEvidence,
} from "./evidence.controller";
import { authMiddleware as authenticate } from "@/middleware/auth.middleware";
const router: ExpressRouter = Router();

/**
 * @route   GET /api/evidence
 * @desc    Paginated evidence listing (filterable/searchable)
 * @access  Private
 */
router.get("/", authenticate, listEvidence);

/**
 * @route   POST /api/evidence/presign
 * @desc    Get a secure S3 upload URL
 * @access  Private
 */
router.post("/presign", authenticate, presignEvidence);

/**
 * @route   POST /api/evidence/commit
 * @desc    Finalize evidence record after successful S3 upload
 * @access  Private
 */
router.post("/commit", authenticate, commitEvidence);

/**
 * @route   GET /api/evidence/:id/download
 * @desc    Generate secure presigned GET URL for evidence
 * @access  Private
 */
router.get("/:id/download", authenticate, downloadEvidence);

export default router;

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// - Listing route enables audit dashboards and grant reporting.
// - Order of routes prevents collision with "/:id/download".
// - Ready for rate limiting + role-based gating middleware.
////////////////////////////////////////////////////////////////
