import { VerificationStatus } from "@prisma/client";

export type ConsensusResult =
  | { phase: "PENDING" }
  | { phase: "IN_REVIEW"; approvals: number; rejections: number }
  | { phase: "ACCEPTED" }
  | { phase: "REJECTED" }
  | { phase: "DISPUTED" };

export function evaluateVerificationConsensus(params: {
  requiredVerifiers: number;
  votes: { status: VerificationStatus }[];
}): ConsensusResult {
  const approvals = params.votes.filter(
    (v) => v.status === VerificationStatus.ACCEPTED,
  ).length;

  const rejections = params.votes.filter(
    (v) => v.status === VerificationStatus.REJECTED,
  ).length;

  // Quorum reached — approval wins
  if (approvals >= params.requiredVerifiers) {
    return { phase: "ACCEPTED" };
  }

  // Quorum reached — rejection wins
  if (rejections >= params.requiredVerifiers) {
    return { phase: "REJECTED" };
  }

  // Conflicting signals without quorum → dispute
  if (approvals > 0 && rejections > 0) {
    return { phase: "DISPUTED" };
  }

  // Votes exist but quorum not met
  if (params.votes.length > 0) {
    return { phase: "IN_REVIEW", approvals, rejections };
  }

  // No votes yet
  return { phase: "PENDING" };
}
