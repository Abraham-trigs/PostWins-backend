// apps/backend/src/modules/routing/routing.types.ts
// Purpose: Canonical routing result contract aligned with Prisma RoutingOutcome enum.
// This file defines runtime-safe routing output types derived from schema authority.

import { RoutingOutcome } from "@prisma/client";

/**
 * Canonical routing outcome.
 * Derived directly from Prisma schema.
 * DO NOT redeclare enum locally.
 */
export type CanonicalRoutingOutcome = RoutingOutcome;

/**
 * Explains WHY a routing outcome occurred.
 * This is explainability metadata only.
 * It does NOT replace RoutingOutcome.
 */
export type RoutingReason =
  | "MATCHED"
  | "FALLBACK_NO_MATCH"
  | "FALLBACK_WRONG_INTENT";

/**
 * Result of a routing decision.
 *
 * CONTRACT:
 * - executionBodyId is ALWAYS present.
 * - outcome MUST align with Prisma RoutingOutcome.
 * - Routing NEVER returns null or undefined.
 * - Routing does NOT imply acceptance or verification.
 */
export interface RoutingResult {
  /**
   * Execution body selected by routing.
   * Always present.
   */
  executionBodyId: string;

  /**
   * Canonical routing outcome.
   * Must map exactly to Prisma RoutingOutcome.
   */
  outcome: CanonicalRoutingOutcome;

  /**
   * Human-readable explainability metadata.
   * Used for ledger payload + UI explanation.
   */
  reason: RoutingReason;
}

/**
 * Utility guard to enforce canonical outcome mapping.
 * Prevents accidental string injection.
 */
export function assertRoutingOutcome(value: string): CanonicalRoutingOutcome {
  if (!Object.values(RoutingOutcome).includes(value as RoutingOutcome)) {
    throw new Error(`Invalid routing outcome: ${value}`);
  }
  return value as RoutingOutcome;
}
