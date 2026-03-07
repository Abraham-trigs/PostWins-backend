// apps/backend/src/modules/intake/integrity/integrity.audit.ts
// Purpose: Core integrity detection engine (duplicate detection, cooldown abuse,
// device abuse, and adversarial prompt detection). Supports trusted actors
// (logged-in users / agents) while maintaining strong security enforcement.

import { IntegrityFlag, PostWin } from "@posta/core";

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

/**
 * Context passed from IntegrityService.
 * The service owns state and persistence while this file
 * implements rule logic only.
 */
interface IntegrityAuditContext {
  blacklist: Set<string>;
  lastActivity: Map<string, number>;
  processedHashes: Set<string>;
  deviceRegistry: Map<string, string[]>;
  violationCounters: Map<string, number>;

  COOLDOWN_MS: number;
  MAX_VIOLATIONS: number;

  /**
   * Indicates whether the actor is authenticated.
   * Trusted actors bypass spam heuristics but NOT security rules.
   */
  isTrusted?: boolean;

  saveRegistry: () => void;
  saveBlacklist: () => void;
}

////////////////////////////////////////////////////////////////
// Integrity Audit Engine
////////////////////////////////////////////////////////////////

export function performFullAudit(
  context: IntegrityAuditContext,
  postWin: PostWin,
  rawMessage: string,
  deviceId?: string,
): IntegrityFlag[] {
  const {
    blacklist,
    lastActivity,
    processedHashes,
    deviceRegistry,
    violationCounters,
    COOLDOWN_MS,
    MAX_VIOLATIONS,
    saveRegistry,
    saveBlacklist,
    isTrusted,
  } = context;

  ////////////////////////////////////////////////////////////////
  // Hard blacklist enforcement (ALWAYS enforced)
  ////////////////////////////////////////////////////////////////

  if (deviceId && blacklist.has(deviceId)) {
    return [
      {
        type: "IDENTITY_MISMATCH",
        severity: "HIGH",
        timestamp: Date.now(),
      },
    ];
  }

  const flags: IntegrityFlag[] = [];

  ////////////////////////////////////////////////////////////////
  // Cooldown spam detection
  // Trusted users bypass this rule
  ////////////////////////////////////////////////////////////////

  if (deviceId && !isTrusted) {
    const now = Date.now();
    const lastTime = lastActivity.get(deviceId) || 0;

    if (now - lastTime < COOLDOWN_MS) {
      flags.push({
        type: "SUSPICIOUS_TONE",
        severity: "LOW",
        timestamp: now,
      });
    }

    lastActivity.set(deviceId, now);
  }

  ////////////////////////////////////////////////////////////////
  // Duplicate claim detection
  ////////////////////////////////////////////////////////////////

  const hash = rawMessage.toLowerCase().trim();

  /**
   * Anonymous users cannot repeat the same narrative
   * to prevent spam campaigns.
   */
  if (processedHashes.has(hash) && !isTrusted) {
    flags.push({
      type: "DUPLICATE_CLAIM",
      severity: "HIGH",
      timestamp: Date.now(),
    });
  }

  /**
   * Only store hashes for anonymous users.
   * Trusted actors may legitimately repeat narratives.
   */
  if (!isTrusted) {
    processedHashes.add(hash);
  }

  ////////////////////////////////////////////////////////////////
  // Device → Beneficiary relationship tracking
  ////////////////////////////////////////////////////////////////

  if (deviceId) {
    const beneficiaryId = postWin.beneficiaryId ?? "unknown";

    const linkedBeneficiaries = deviceRegistry.get(deviceId) || [];

    if (!linkedBeneficiaries.includes(beneficiaryId)) {
      linkedBeneficiaries.push(beneficiaryId);
      deviceRegistry.set(deviceId, linkedBeneficiaries);

      // Persist updated device mapping
      saveRegistry();
    }

    /**
     * IMPORTANT PRODUCTION RULE:
     *
     * Anonymous devices should not create large numbers
     * of beneficiaries.
     *
     * Trusted actors (agents, NGO staff) may legitimately
     * submit cases for many beneficiaries from a shared
     * office computer or field tablet.
     */
    if (!isTrusted && linkedBeneficiaries.length > 3) {
      flags.push({
        type: "IDENTITY_MISMATCH",
        severity: "HIGH",
        timestamp: Date.now(),
      });
    }
  }

  ////////////////////////////////////////////////////////////////
  // Prompt injection / adversarial input detection
  ////////////////////////////////////////////////////////////////

  /**
   * These checks are ALWAYS enforced.
   * Trusted actors cannot bypass them.
   */
  const patterns = [
    /ignore previous instructions/i,
    /system override/i,
    /<script/i,
  ];

  if (patterns.some((p) => p.test(rawMessage))) {
    flags.push({
      type: "SUSPICIOUS_TONE",
      severity: "HIGH",
      timestamp: Date.now(),
    });
  }

  ////////////////////////////////////////////////////////////////
  // Escalation system (device blacklisting)
  ////////////////////////////////////////////////////////////////

  if (deviceId && flags.some((f) => f.severity === "HIGH")) {
    const count = (violationCounters.get(deviceId) || 0) + 1;

    violationCounters.set(deviceId, count);

    /**
     * Automatically blacklist repeated offenders
     */
    if (count >= MAX_VIOLATIONS) {
      blacklist.add(deviceId);
      saveBlacklist();
    }
  }

  return flags;
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
This audit engine separates fraud-rule evaluation from persistence.
IntegrityService owns state while this module evaluates rule logic.

The isTrusted flag allows authenticated actors (agents, NGOs,
staff dashboards) to bypass anti-spam heuristics while still
enforcing strict security protections such as prompt injection
detection and blacklist enforcement.

This prevents operational friction for real users while keeping
anonymous abuse tightly controlled.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
performFullAudit()

1. Blacklist enforcement
2. Spam cooldown detection
3. Duplicate narrative detection
4. Device → beneficiary mapping integrity
5. Prompt injection detection
6. Escalation / automatic blacklisting
*/

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Called by IntegrityService:

performFullAudit(
  {
    blacklist,
    processedHashes,
    deviceRegistry,
    violationCounters,
    isTrusted,
    ...
  },
  postWin,
  narrative,
  deviceId
)

The controller determines isTrusted based on
whether the request has a valid authenticated user.
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
For multi-instance deployments move these structures to Redis:

- processedHashes
- violationCounters
- deviceRegistry

This prevents fraud bypass when requests hit different API nodes.
*/

////////////////////////////////////////////////////////////////
// Example usage
////////////////////////////////////////////////////////////////
/*
const flags = performFullAudit(
  context,
  { beneficiaryId: "beneficiary_123" } as PostWin,
  "We need clean water access for our village",
  "device_abc"
);

console.log(flags);
*/
