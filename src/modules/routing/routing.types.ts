/**
 * Explains why a particular execution body was selected during routing.
 *
 * IMPORTANT:
 * - Routing is a decision, not acceptance.
 * - Every routing decision MUST terminate with an executionBodyId.
 * - Fallback reasons indicate why normal routing failed,
 *   not that the fallback NGO was preferred.
 */
export type RoutingReason =
  /**
   * A candidate execution body explicitly matched
   * the intent and all routing constraints.
   */
  | "MATCHED"

  /**
   * No candidate execution bodies were available
   * for routing at all.
   *
   * The system routed to the fallback execution body
   * to preserve routing completeness.
   */
  | "FALLBACK_NO_MATCH"

  /**
   * Candidate execution bodies existed, but none
   * were compatible with the case intent or constraints.
   *
   * The system rejected the intent for all candidates
   * and routed to the fallback execution body.
   */
  | "FALLBACK_WRONG_INTENT";

/**
 * Result of a routing decision.
 *
 * CONTRACT:
 * - executionBodyId is ALWAYS present.
 * - Routing NEVER returns null or undefined.
 * - Responsibility is NOT transferred by routing alone.
 *   Acceptance or verification must occur separately.
 */
export type RoutingResult = {
  /**
   * The execution body selected as the routing destination.
   * This may be a normal NGO execution body or the fallback one.
   */
  executionBodyId: string;

  /**
   * The reason this execution body was selected.
   * Used for explainability, auditing, and ledger recording.
   */
  reason: RoutingReason;
};
