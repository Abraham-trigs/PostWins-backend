import { ViewerContext } from "./viewer-context";

export type RedactionRule = {
  canSeePII: boolean;
  canSeeEvidence: boolean;
  canSeeSupersededDecisions: boolean;
  canSeeLedgerPayloads: boolean;
};

export function resolveRedactionPolicy(viewer: ViewerContext): RedactionRule {
  if (viewer.roles.includes("ADMIN")) {
    return {
      canSeePII: true,
      canSeeEvidence: true,
      canSeeSupersededDecisions: true,
      canSeeLedgerPayloads: true,
    };
  }

  if (viewer.roles.includes("AUDITOR")) {
    return {
      canSeePII: false,
      canSeeEvidence: true,
      canSeeSupersededDecisions: true,
      canSeeLedgerPayloads: true,
    };
  }

  if (viewer.roles.includes("NGO_PARTNER")) {
    return {
      canSeePII: false,
      canSeeEvidence: true,
      canSeeSupersededDecisions: false,
      canSeeLedgerPayloads: false,
    };
  }

  // Optional explicit SYSTEM default (safe future-proofing)
  if (viewer.actorKind === "SYSTEM") {
    return {
      canSeePII: false,
      canSeeEvidence: false,
      canSeeSupersededDecisions: true,
      canSeeLedgerPayloads: true,
    };
  }

  // Default: beneficiary / public
  return {
    canSeePII: false,
    canSeeEvidence: false,
    canSeeSupersededDecisions: false,
    canSeeLedgerPayloads: false,
  };
}
