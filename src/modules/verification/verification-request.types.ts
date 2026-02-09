export type VerificationTrigger =
  | "INTAKE"
  | "DELIVERY"
  | "FOLLOWUP"
  | "GRANT_CONDITION"
  | "MANUAL";

export type EnsureVerificationInput = {
  tenantId: string;
  caseId: string;

  trigger: VerificationTrigger;

  /**
   * Deterministic role keys allowed to verify.
   * Example: ["NGO_PARTNER", "STAFF"]
   */
  requiredRoleKeys: string[];

  /**
   * Minimum number of confirmations required.
   */
  requiredVerifiers: number;

  /**
   * Who requested the verification (system or human).
   */
  requestedBy: { kind: "SYSTEM" } | { kind: "USER"; userId: string };
};
