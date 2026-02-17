import { VerificationStatus } from "@prisma/client";
import { evaluateVerificationConsensus } from "./evaluateVerificationConsensus";

export function explainVerificationState(params: {
  requiredVerifiers: number;
  requiredRoles: string[];
  votes: {
    verifierUserId: string;
    roleKey: string;
    status: VerificationStatus;
    createdAt: Date;
  }[];
}) {
  const consensus = evaluateVerificationConsensus({
    requiredVerifiers: params.requiredVerifiers,
    votes: params.votes,
  });

  const approvals = params.votes.filter(
    (v) => v.status === VerificationStatus.APPROVED,
  );
  const rejections = params.votes.filter(
    (v) => v.status === VerificationStatus.REJECTED,
  );

  return {
    phase: consensus.phase,

    summary: (() => {
      switch (consensus.phase) {
        case "PENDING":
          return "Verification has not received any submissions yet.";

        case "IN_REVIEW":
          return `Verification is in progress. ${approvals.length} approval(s), ${rejections.length} rejection(s) recorded.`;

        case "APPROVED":
          return "Required quorum approved the completed execution.";

        case "REJECTED":
          return "Required quorum rejected the completed execution.";

        case "DISPUTED":
          return "Conflicting verification submissions triggered a dispute.";
      }
    })(),

    quorum: {
      required: params.requiredVerifiers,
      approvals: approvals.length,
      rejections: rejections.length,
      remainingApprovalsNeeded: Math.max(
        0,
        params.requiredVerifiers - approvals.length,
      ),
      remainingRejectionsNeeded: Math.max(
        0,
        params.requiredVerifiers - rejections.length,
      ),
    },

    voters: params.votes.map((v) => ({
      verifierUserId: v.verifierUserId,
      role: v.roleKey,
      status: v.status,
      votedAt: v.createdAt,
    })),

    requiredRoles: params.requiredRoles,

    counterfactuals: {
      ifNextVoteApproved:
        approvals.length + 1 >= params.requiredVerifiers
          ? "Verification would be APPROVED"
          : "Verification would remain unresolved",

      ifNextVoteRejected:
        rejections.length + 1 >= params.requiredVerifiers
          ? "Verification would be REJECTED"
          : "Verification would remain unresolved",
    },
  };
}
