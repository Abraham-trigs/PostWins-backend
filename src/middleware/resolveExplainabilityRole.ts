// src/middleware/resolveExplainabilityRole.ts
// Maps authenticated user roles to ExplainabilityRole domain contract

import type { Request } from "express";
import { ExplainabilityRole } from "../modules/explainability/explainability.types";

/**
 * Extend Express Request to include authenticated user shape.
 * We keep it local to avoid global ambient type pollution.
 */
type AuthenticatedRequest = Request & {
  user?: {
    roles?: string[];
  };
};

// Centralized mapping: auth → epistemic access
export function resolveExplainabilityRole(
  req: AuthenticatedRequest,
): ExplainabilityRole {
  const roles: string[] = req.user?.roles ?? [];

  if (roles.includes("ADMIN") || roles.includes("STAFF")) {
    return "INTERNAL";
  }

  if (roles.includes("REGULATOR") || roles.includes("AUDITOR")) {
    return "AUDITOR";
  }

  if (
    roles.includes("DONOR") ||
    roles.includes("NGO_PARTNER") ||
    roles.includes("IMPLEMENTER")
  ) {
    return "PARTNER";
  }

  return "PUBLIC";
}
