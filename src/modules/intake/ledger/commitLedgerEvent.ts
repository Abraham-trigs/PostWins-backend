// apps/backend/src/modules/intake/ledger/commitLedgerEvent.ts
// Canonical functional ledger entry point.
// Wraps LedgerService.commit() with structured actor input,
// transaction support, and stable typing.

import { LedgerService } from "./ledger.service";
import { Prisma, LedgerEventType, ActorKind } from "@prisma/client";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Actor Schema (Structured Authority)
////////////////////////////////////////////////////////////////

const ActorSchema = z.object({
  kind: z.nativeEnum(ActorKind),
  userId: z.string().uuid().optional(),
  authorityProof: z.string().min(1),
});

export type LedgerActor = z.infer<typeof ActorSchema>;

////////////////////////////////////////////////////////////////
// Commit Input Schema
////////////////////////////////////////////////////////////////

const CommitLedgerEventSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid().nullable().optional(),
  eventType: z.nativeEnum(LedgerEventType),
  actor: ActorSchema,
  intentContext: z.unknown().optional(),
  payload: z.unknown().optional(),
  supersedesCommitId: z.string().uuid().nullable().optional(),
});

export type CommitLedgerEventParams = z.infer<typeof CommitLedgerEventSchema>;

////////////////////////////////////////////////////////////////
// Ledger Singleton
////////////////////////////////////////////////////////////////

let ledgerInstance: LedgerService | null = null;

function getLedger(): LedgerService {
  if (!ledgerInstance) {
    ledgerInstance = new LedgerService();
  }
  return ledgerInstance;
}

////////////////////////////////////////////////////////////////
// Canonical Functional Commit
////////////////////////////////////////////////////////////////

export async function commitLedgerEvent(
  input: CommitLedgerEventParams,
  tx?: Prisma.TransactionClient,
) {
  const parsed = CommitLedgerEventSchema.parse(input);

  const ledger = getLedger();

  return ledger.appendEntry(
    {
      tenantId: parsed.tenantId,
      caseId: parsed.caseId ?? null,
      eventType: parsed.eventType,
      actorKind: parsed.actor.kind,
      actorUserId:
        parsed.actor.kind === ActorKind.HUMAN
          ? (parsed.actor.userId ?? null)
          : null,
      authorityProof: parsed.actor.authorityProof,
      intentContext: parsed.intentContext ?? null,
      payload: parsed.payload ?? {},
      supersedesCommitId: parsed.supersedesCommitId ?? null,
    },
    tx,
  );
}

////////////////////////////////////////////////////////////////
// Example usage
////////////////////////////////////////////////////////////////

/*
await commitLedgerEvent(
  {
    tenantId,
    caseId,
    eventType: LedgerEventType.ROUTED,
    actor: {
      kind: ActorKind.SYSTEM,
      authorityProof: SYSTEM_AUTHORITY_PROOF,
    },
    payload: buildAuthorityEnvelopeV1({
      domain: "ROUTING",
      event: "ROUTED",
      data: { executionBodyId },
    }),
  },
  tx,
);
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// This wrapper prevents ledger API drift.
// All domain modules use structured actor objects.
// LedgerService remains constitutional core.
// Functional wrapper stabilizes import surface.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod boundary validation
// - Structured actor enforcement
// - Singleton LedgerService
// - Transaction-aware delegation
// - Zero business logic

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Replace all commitLedgerEvent imports across codebase.
// - Remove any routing-level commit wrappers.
// - Never call LedgerService directly from domain modules.
// - All payloads must be envelope-wrapped before commit.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Centralizing commit access prevents future API drift.
// Enables audit hooks, metrics, or tracing without touching 30 files.
// Authority remains cryptographically enforced at LedgerService layer.
// This is now the single constitutional entry point.
////////////////////////////////////////////////////////////////
