// apps/backend/src/modules/intake/ledger/authorityEnvelope.ts
// Versioned authority envelope builder.
// Assumes: LedgerService hashes entire payload deterministically.
// This module introduces replay-safe evolution of ledger payloads.

import { z } from "zod";

////////////////////////////////////////////////////////////////
// Envelope Schema (V1)
////////////////////////////////////////////////////////////////

export const AuthorityEnvelopeV1Schema = z.object({
  envelopeVersion: z.literal(1),
  domain: z.string().min(1),
  event: z.string().min(1),
  data: z.unknown(),
});

export type AuthorityEnvelopeV1 = z.infer<typeof AuthorityEnvelopeV1Schema>;

////////////////////////////////////////////////////////////////
// Envelope Builder
////////////////////////////////////////////////////////////////

export function buildAuthorityEnvelopeV1(params: {
  domain: string;
  event: string;
  data: unknown;
}): AuthorityEnvelopeV1 {
  const envelope: AuthorityEnvelopeV1 = {
    envelopeVersion: 1,
    domain: params.domain,
    event: params.event,
    data: params.data,
  };

  return AuthorityEnvelopeV1Schema.parse(envelope);
}

////////////////////////////////////////////////////////////////
// Envelope Type Guard
////////////////////////////////////////////////////////////////

export function isAuthorityEnvelopeV1(
  payload: unknown,
): payload is AuthorityEnvelopeV1 {
  return AuthorityEnvelopeV1Schema.safeParse(payload).success;
}

////////////////////////////////////////////////////////////////
// Example Usage
////////////////////////////////////////////////////////////////

/*
const envelope = buildAuthorityEnvelopeV1({
  domain: "CASE_LIFECYCLE",
  event: "TRANSITION",
  data: { from: "INTAKE", to: "ROUTED" },
});
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Envelope versioning prevents replay breakage when payload evolves.
// eventType (Prisma enum) remains authoritative classification.
// envelopeVersion governs payload schema evolution only.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod schema
// - Deterministic builder
// - Strict version literal
// - Safe type guard for replay logic

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - All new ledger commits must wrap payloads in envelope.
// - Never write raw payload directly to LedgerCommit again.
// - Future versions must be additive and backward-compatible.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Versioned envelopes enable multi-year ledger durability.
// Replay logic can branch by envelopeVersion without
// database schema changes. This protects institutional memory.
////////////////////////////////////////////////////////////////
