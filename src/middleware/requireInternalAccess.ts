import { Request, Response, NextFunction } from "express";

/**
 * Phase 5 — Internal-only access guard
 *
 * Explicit boundary for audit / explainability endpoints.
 *
 * Current behavior:
 * - Assumes authentication already happened upstream
 * - Acts as a no-op placeholder
 *
 * Role / scope enforcement can be added later
 * without changing any routes.
 */
export function requireInternalAccess(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  return next();
}
