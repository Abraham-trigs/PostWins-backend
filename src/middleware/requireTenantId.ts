import { Request, Response, NextFunction } from "express";

/**
 * Enforces tenant scoping for all protected routes.
 *
 * Phase 1+ invariant:
 * - Every request must be associated with a tenant
 * - No cross-tenant access is allowed
 *
 * Assumes tenant identity is provided via header or auth context.
 */
export function requireTenantId(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const tenantId = req.headers["x-tenant-id"] ?? req.headers["X-Tenant-Id"];

  if (!tenantId || typeof tenantId !== "string") {
    return res.status(400).json({
      error: "Missing or invalid tenant id",
    });
  }

  // Attach for downstream use
  (req as any).tenantId = tenantId;

  return next();
}
