// apps/backend/src/modules/auth/trust/buildTrustContext.ts

import { Request } from "express";
import { TrustContext } from "./trust.context";

/**
 * Factory for creating a canonical TrustContext from a request.
 *
 * Design reasoning:
 * Centralizing this logic ensures that "isTrusted" is calculated
 * identically across all intake and governance modules.
 */
export function buildTrustContext(
  req: Request,
  tenantId: string,
  authorUserId?: string,
  actorRole?: TrustContext["actorRole"],
): TrustContext {
  /**
   * Resolve device identity.
   * X-Device-Id is the preferred fingerprint for integrity rules.
   */
  const deviceId = req.header("X-Device-Id") ?? "unknown";

  /**
   * Determine trust status.
   * Logic: If we have an authenticated user ID, the request is trusted.
   * This allows agents and tenants to bypass anti-spam heuristics.
   */
  const isTrusted = !!authorUserId;

  return {
    isTrusted,
    actorUserId: authorUserId || undefined,
    tenantId,
    deviceId,
    actorRole: actorRole || (isTrusted ? "USER" : "GUEST"),
  };
}
