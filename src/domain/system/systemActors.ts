/**
 * Canonical key for the fallback NGO used by the system.
 * This is NOT a system organization.
 */
export const KHALISTAR_ORG_KEY = "KHALISTAR" as const;

/**
 * Authority proof used when the SYSTEM acts
 * and delegates execution to Khalistar.
 */
export const SYSTEM_AUTHORITY_PROOF = `system:${KHALISTAR_ORG_KEY}` as const;
