// apps/backend/src/modules/routing/routing.types.ts
// Canonical routing result contract aligned with Prisma RoutingOutcome enum.

import { RoutingOutcome } from "@prisma/client";

/**
 * Canonical routing outcome derived from Prisma schema.
 */
export type CanonicalRoutingOutcome = RoutingOutcome;

/**
 * Human-readable explainability metadata.
 * Does NOT replace RoutingOutcome.
 */
export type RoutingReason =
  | "MATCHED"
  | "FALLBACK_NO_MATCH"
  | "FALLBACK_NO_CANDIDATES";

/**
 * Result of a routing decision.
 *
 * CONTRACT:
 * - executionBodyId is ALWAYS present
 * - outcome MUST align with Prisma RoutingOutcome
 * - Routing NEVER returns null
 */
export interface RoutingResult {
  executionBodyId: string;
  outcome: CanonicalRoutingOutcome;
  reason: RoutingReason;
}

/**
 * Utility guard to enforce canonical enum mapping.
 */
export function assertRoutingOutcome(value: string): CanonicalRoutingOutcome {
  if (!Object.values(RoutingOutcome).includes(value as RoutingOutcome)) {
    throw new Error(`Invalid routing outcome: ${value}`);
  }
  return value as RoutingOutcome;
}
