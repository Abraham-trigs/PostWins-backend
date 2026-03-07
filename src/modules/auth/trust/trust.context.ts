// apps/backend/src/modules/auth/trust/trust.context.ts

export type TrustContext = {
  /**
   * Whether the request is coming from an authenticated actor
   * allowed to bypass anonymous anti-spam heuristics.
   */
  isTrusted: boolean;

  /**
   * Actor user ID if authenticated.
   */
  actorUserId?: string;

  /**
   * Tenant boundary for the request.
   */
  tenantId: string;

  /**
   * Device fingerprint used by integrity rules.
   */
  deviceId: string;

  /**
   * Optional role classification used for policy decisions.
   */
  actorRole?: "ADMIN" | "AGENT" | "USER" | "SYSTEM" | "GUEST";
};
