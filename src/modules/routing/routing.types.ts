// filepath: apps/backend/src/modules/routing/routing.types.ts
// Purpose: Canonical routing result contract aligned with Prisma RoutingOutcome enum.

////////////////////////////////////////////////////////////////
// Assumptions
////////////////////////////////////////////////////////////////
// - Prisma schema defines RoutingOutcome enum
// - Routing engine always returns deterministic results
// - Reason codes are explainability metadata only

////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////

import { RoutingOutcome } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Canonical outcome type
////////////////////////////////////////////////////////////////

/**
 * Canonical routing outcome derived from Prisma schema.
 * This ensures all routing decisions remain aligned with DB enum.
 */
export type CanonicalRoutingOutcome = RoutingOutcome;

////////////////////////////////////////////////////////////////
// Explainability metadata
////////////////////////////////////////////////////////////////

/**
 * Human-readable routing explanation.
 * These are NOT persisted as enums and are purely diagnostic.
 */
export type RoutingReason =
  | "ORIGINATOR_CAPABLE"
  | "MATCHED"
  | "FALLBACK_NO_MATCH"
  | "FALLBACK_NO_CANDIDATES";

////////////////////////////////////////////////////////////////
// Routing result contract
////////////////////////////////////////////////////////////////

/**
 * Deterministic routing result.
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

////////////////////////////////////////////////////////////////
// Enum guard (no unsafe casts)
////////////////////////////////////////////////////////////////

/**
 * Runtime guard ensuring value belongs to Prisma RoutingOutcome enum.
 * Avoids unsafe `as RoutingOutcome` casts.
 */
export function assertRoutingOutcome(value: string): CanonicalRoutingOutcome {
  const validValues = Object.values(RoutingOutcome);

  if (validValues.includes(value as RoutingOutcome)) {
    return value as CanonicalRoutingOutcome;
  }

  throw new Error(`Invalid routing outcome: ${value}`);
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// RoutingOutcome is owned by Prisma schema and must remain the
// canonical enum for persistence and logic.
//
// RoutingReason provides explainability metadata for UI and
// debugging without polluting the database enum surface.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - CanonicalRoutingOutcome (Prisma enum alias)
// - RoutingReason (diagnostic metadata)
// - RoutingResult interface
// - assertRoutingOutcome() runtime guard

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Use RoutingOutcome directly in routing engines:
//
// return {
//   executionBodyId,
//   outcome: RoutingOutcome.MATCHED,
//   reason: "MATCHED",
// }
//
// assertRoutingOutcome() should only be used when parsing
// external input such as APIs or replay logs.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// If routing outcomes expand (e.g. ESCALATED, MANUAL_REVIEW),
// only the Prisma enum must change. The entire routing engine,
// type system, and persistence layer will compile-fail until
// updated, preventing silent behavioral drift.

////////////////////////////////////////////////////////////////
// Example usage
////////////////////////////////////////////////////////////////

/*
const result: RoutingResult = {
  executionBodyId: "body_1",
  outcome: RoutingOutcome.MATCHED,
  reason: "MATCHED",
};
*/
