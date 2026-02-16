// Authority hierarchy enforcement layer.
// Pure policy. No DB writes. No hashing impact.

import { ActorKind } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Authority Levels (derived, not stored)
////////////////////////////////////////////////////////////////

export enum AuthorityLevel {
  SYSTEM_AUTOMATED = 1,
  HUMAN_VERIFIER = 2,
  HUMAN_ADMIN = 3,
  EXECUTIVE_OVERRIDE = 4,
}

////////////////////////////////////////////////////////////////
// Derivation
////////////////////////////////////////////////////////////////

// NOTE:
// For now we derive from actorKind only.
// You can later expand this to inspect role, claims,
// authorityProof format, etc.

export function deriveAuthorityLevel(
  actorKind: ActorKind,
  authorityProof: string,
): AuthorityLevel {
  if (actorKind === ActorKind.SYSTEM) {
    return AuthorityLevel.SYSTEM_AUTOMATED;
  }

  // Minimal v1 classification:
  // Convention-based elevation via authorityProof prefix.
  // This avoids schema migration while enabling hierarchy.

  if (authorityProof.startsWith("EXEC:")) {
    return AuthorityLevel.EXECUTIVE_OVERRIDE;
  }

  if (authorityProof.startsWith("ADMIN:")) {
    return AuthorityLevel.HUMAN_ADMIN;
  }

  return AuthorityLevel.HUMAN_VERIFIER;
}

////////////////////////////////////////////////////////////////
// Supersession Validation
////////////////////////////////////////////////////////////////

export function validateAuthoritySupersession(params: {
  newActorKind: ActorKind;
  newAuthorityProof: string;
  targetActorKind: ActorKind;
  targetAuthorityProof: string;
}) {
  const newLevel = deriveAuthorityLevel(
    params.newActorKind,
    params.newAuthorityProof,
  );

  const targetLevel = deriveAuthorityLevel(
    params.targetActorKind,
    params.targetAuthorityProof,
  );

  // Rule 1:
  // Lower authority cannot supersede higher authority.
  if (newLevel < targetLevel) {
    throw new Error("INSUFFICIENT_AUTHORITY_FOR_SUPERSESSION");
  }

  // Rule 2:
  // SYSTEM cannot supersede HUMAN.
  if (
    newLevel === AuthorityLevel.SYSTEM_AUTOMATED &&
    targetLevel > AuthorityLevel.SYSTEM_AUTOMATED
  ) {
    throw new Error("SYSTEM_CANNOT_SUPERSEDE_HUMAN_AUTHORITY");
  }

  // Rule 3:
  // Equal authority requires escalation unless explicitly allowed.
  if (newLevel === targetLevel) {
    throw new Error("EQUAL_AUTHORITY_SUPERSESSION_REQUIRES_ESCALATION");
  }
}
