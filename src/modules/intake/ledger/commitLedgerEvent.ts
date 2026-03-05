// filepath: apps/backend/src/modules/intake/ledger/commitLedgerEvent.ts
// Purpose: Canonical functional ledger entry point with strict validation, JSON normalization,
// and safe Prisma transaction support.

////////////////////////////////////////////////////////////////
// Assumptions
////////////////////////////////////////////////////////////////
// - Prisma schema includes LedgerCommit model using JSON columns
// - LedgerService.appendEntry persists the authoritative ledger record
// - All domain modules must call this wrapper instead of LedgerService directly

////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////

import { LedgerService } from "./ledger.service";
import { Prisma, LedgerEventType, ActorKind } from "@prisma/client";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Helper: JSON normalization (prevents unsafe Prisma JSON writes)
////////////////////////////////////////////////////////////////

/**
 * Ensures value is JSON-serializable before sending to Prisma.
 * Prevents runtime failures caused by Date, BigInt, Map, functions, etc.
 */
function normalizeJson(input: unknown): Prisma.InputJsonValue | null {
  if (input === undefined || input === null) return null;

  try {
    return JSON.parse(JSON.stringify(input));
  } catch {
    throw new Error("Ledger payload must be JSON serializable");
  }
}

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

      // JSON normalization boundary
      intentContext: normalizeJson(parsed.intentContext),
      payload: normalizeJson(parsed.payload ?? {}),

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
// Ledger commits are the constitutional audit record of the system.
// This wrapper ensures:
//
// - strict enum validation via Zod
// - structured actor authority
// - JSON serialization safety
// - single import surface for all domain modules
//
// By normalizing JSON here we prevent Prisma runtime failures
// caused by non-serializable objects entering the ledger.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod schemas enforce boundary validation
// - normalizeJson() guarantees Prisma-safe JSON
// - Singleton LedgerService prevents repeated instantiation
// - commitLedgerEvent() acts as the canonical entry point

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Domain modules should never call LedgerService directly.
// Always import:
//
// import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
//
// This keeps governance, metrics, and tracing centralized.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Because every ledger write flows through this function,
// you can later introduce:
//
// - distributed tracing
// - audit hooks
// - metrics instrumentation
// - signature verification
//
// without modifying dozens of domain modules.
