import { ExplainabilityRole } from "../modules/explainability/explainability.types";

// Centralized mapping: auth → epistemic access
export function resolveExplainabilityRole(req): ExplainabilityRole {
  const roles = req.user?.roles ?? [];

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
