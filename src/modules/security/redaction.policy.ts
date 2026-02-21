import { ViewerContext } from "./viewer-context";

export type RedactionRule = {
  canSeeRestrictedCases: boolean;
  canSeePII: boolean;
  canSeeEvidence: boolean;
  canSeeSupersededDecisions: boolean;
  canSeeLedgerPayloads: boolean;
};

export function resolveRedactionPolicy(viewer: ViewerContext): RedactionRule {
  if (viewer.roles.includes("ADMIN")) {
    return {
      canSeeRestrictedCases: true,
      canSeePII: true,
      canSeeEvidence: true,
      canSeeSupersededDecisions: true,
      canSeeLedgerPayloads: true,
    };
  }

  if (viewer.roles.includes("AUDITOR")) {
    return {
      canSeeRestrictedCases: true,
      canSeePII: false,
      canSeeEvidence: true,
      canSeeSupersededDecisions: true,
      canSeeLedgerPayloads: true,
    };
  }

  if (viewer.roles.includes("NGO_PARTNER")) {
    return {
      canSeeRestrictedCases: false,
      canSeePII: false,
      canSeeEvidence: true,
      canSeeSupersededDecisions: false,
      canSeeLedgerPayloads: false,
    };
  }

  // SYSTEM actor default
  if (viewer.actorKind === "SYSTEM") {
    return {
      canSeeRestrictedCases: false,
      canSeePII: false,
      canSeeEvidence: false,
      canSeeSupersededDecisions: true,
      canSeeLedgerPayloads: true,
    };
  }

  // Default: beneficiary / public
  return {
    canSeeRestrictedCases: false,
    canSeePII: false,
    canSeeEvidence: false,
    canSeeSupersededDecisions: false,
    canSeeLedgerPayloads: false,
  };
}
