// apps/backend/src/modules/intake/ledger/authorityHierarchy.policy.ts
// Purpose: Authority hierarchy enforcement layer.
// Pure policy. No DB writes. No hashing impact.

import { ActorKind } from "@prisma/client";

/* =========================================================
   Authority Levels (Derived)
   ========================================================= */

export enum AuthorityLevel {
  SYSTEM_AUTOMATED = 1,
  HUMAN_VERIFIER = 2,
  HUMAN_ADMIN = 3,
  EXECUTIVE_OVERRIDE = 4,
}

/* =========================================================
   Derivation Logic
   ========================================================= */

/**
 * Classifies an actor's power level based on their Kind and Proof.
 * Enables hierarchy without requiring complex database lookups.
 */
export function deriveAuthorityLevel(
  actorKind: ActorKind,
  authorityProof: string,
): AuthorityLevel {
  // 1. System is always base level
  if (actorKind === ActorKind.SYSTEM) {
    return AuthorityLevel.SYSTEM_AUTOMATED;
  }

  // 2. Convention-based elevation via authorityProof prefix.
  // This allows the ledger to remain agnostic of your specific Auth system.
  if (authorityProof.startsWith("EXEC:")) {
    return AuthorityLevel.EXECUTIVE_OVERRIDE;
  }

  if (authorityProof.startsWith("ADMIN:")) {
    return AuthorityLevel.HUMAN_ADMIN;
  }

  // 3. Default for Human actors
  return AuthorityLevel.HUMAN_VERIFIER;
}

/* =========================================================
   Supersession Validation
   ========================================================= */

/**
 * Enforces the "Sovereign" rules of the ledger.
 * Prevents history tampering by lower-tier authorities.
 */
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

  // Rule 1: Mathematical Hierarchy
  // Lower authority cannot supersede higher authority.
  if (newLevel < targetLevel) {
    throw new Error("INSUFFICIENT_AUTHORITY_FOR_SUPERSESSION");
  }

  // Rule 2: Human Primacy
  // SYSTEM processes can never overwrite HUMAN intent unless explicitly elevated.
  if (
    newLevel === AuthorityLevel.SYSTEM_AUTOMATED &&
    targetLevel > AuthorityLevel.SYSTEM_AUTOMATED
  ) {
    throw new Error("SYSTEM_CANNOT_SUPERSEDE_HUMAN_AUTHORITY");
  }

  // Rule 3: Loop Prevention
  // Equal authorities cannot supersede each other.
  // Forces the user to provide a higher-tier "ADMIN" or "EXEC" proof to change history.
  if (newLevel === targetLevel) {
    throw new Error("EQUAL_AUTHORITY_SUPERSESSION_REQUIRES_ESCALATION");
  }
}
