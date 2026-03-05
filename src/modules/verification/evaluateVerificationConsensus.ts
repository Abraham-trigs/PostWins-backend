// apps/backend/src/modules/verification/evaluateVerificationConsensus.ts
// Purpose: Domain-level consensus evaluator for verification votes.
// Determines verification outcome using deterministic quorum rules.

/*
Design reasoning

Verification status is not stored in the database. It is derived from the
VerificationRecord and its child Verification votes. This file centralizes
that derivation logic so it lives in the domain layer rather than leaking
into mappers or controllers.

The function evaluates consensus using deterministic quorum rules based on
the required number of verifiers and their vote statuses. This ensures the
system never trusts mutable fields like `consensusReached` blindly.

The file also exposes a helper adapter that converts the domain consensus
result into the transport-safe VerificationStatus used by PostWin DTOs.
*/

/*
Structure

ConsensusResult
  Rich domain evaluation result describing verification state.

evaluateVerificationConsensus()
  Core domain evaluator returning ConsensusResult.

deriveVerificationStatus()
  Adapter converting ConsensusResult → VerificationStatus for API DTOs.
*/

import type { VerificationStatus } from "@posta/core/src/generated/enums";

/* -------------------------------------------------------------------------- */
/* Types */
/* -------------------------------------------------------------------------- */

export type ConsensusResult =
  | { phase: "PENDING" }
  | { phase: "IN_REVIEW"; approvals: number; rejections: number }
  | { phase: "APPROVED" }
  | { phase: "REJECTED" }
  | { phase: "DISPUTED" };

/* -------------------------------------------------------------------------- */
/* Core Domain Evaluation */
/* -------------------------------------------------------------------------- */

/**
 * evaluateVerificationConsensus
 *
 * Determines verification consensus from vote set.
 */
export function evaluateVerificationConsensus(params: {
  requiredVerifiers: number;
  votes: { status: VerificationStatus }[];
}): ConsensusResult {
  const approvals = params.votes.filter((v) => v.status === "APPROVED").length;

  const rejections = params.votes.filter((v) => v.status === "REJECTED").length;

  // Approval quorum reached
  if (approvals >= params.requiredVerifiers) {
    return { phase: "APPROVED" };
  }

  // Rejection quorum reached
  if (rejections >= params.requiredVerifiers) {
    return { phase: "REJECTED" };
  }

  // Conflicting signals without quorum
  if (approvals > 0 && rejections > 0) {
    return { phase: "DISPUTED" };
  }

  // Votes exist but quorum not met
  if (params.votes.length > 0) {
    return {
      phase: "IN_REVIEW",
      approvals,
      rejections,
    };
  }

  // No votes yet
  return { phase: "PENDING" };
}

/* -------------------------------------------------------------------------- */
/* Adapter for API projection layer */
/* -------------------------------------------------------------------------- */

/**
 * deriveVerificationStatus
 *
 * Converts domain ConsensusResult → VerificationStatus used by API DTOs.
 */
export function deriveVerificationStatus(
  result: ConsensusResult,
): VerificationStatus {
  switch (result.phase) {
    case "APPROVED":
      return "APPROVED";

    case "REJECTED":
      return "REJECTED";

    case "DISPUTED":
      // unresolved conflict → still pending verification
      return "PENDING";

    case "IN_REVIEW":
    case "PENDING":
    default:
      return "PENDING";
  }
}

/* -------------------------------------------------------------------------- */
/* Implementation guidance

Usage inside mapper:

const consensus = evaluateVerificationConsensus({
  requiredVerifiers: record.requiredVerifiers,
  votes: record.receivedVerifications
})

const verificationStatus = deriveVerificationStatus(consensus)

---------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Scalability insight

As verification logic grows (appeals, disputes, role weighting), this
consensus engine can evolve into a full verification policy evaluator.
Keeping it isolated in the domain layer prevents projection code and API
responses from embedding business logic.

---------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Example usage

const consensus = evaluateVerificationConsensus({
  requiredVerifiers: 2,
  votes: [
    { status: "APPROVED" },
    { status: "APPROVED" }
  ]
})

const status = deriveVerificationStatus(consensus)

console.log(status) // "APPROVED"

---------------------------------------------------------------------------- */
