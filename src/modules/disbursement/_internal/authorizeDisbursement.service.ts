// filepath: apps/backend/src/modules/disbursement/_internal/authorizeDisbursement.service.ts
// Purpose: Authorize (not execute) a disbursement after lifecycle + governance invariants, and commit DISBURSEMENT_AUTHORIZED to the ledger.

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import {
  Prisma,
  ActorKind,
  DisbursementStatus,
  DisbursementType,
  LedgerEventType,
  ExecutionStatus,
  CaseLifecycle,
} from "@prisma/client";
import { PAYEE_KINDS } from "@posta/core/src/types";

import { LifecycleInvariantViolationError } from "@/modules/cases/case.errors";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";

/* ================================================================
   Design reasoning   payee
   ================================================================ */
// Authorization must be strict, deterministic, and idempotent per case.
// We do not assume “exactly one” verification round exists; the schema supports multiple rounds.
// For real-world safety: pick the latest consensusReached=true record and bind authorization to it.
// Amount is normalized into Prisma.Decimal(18,2) to match schema and avoid float drift.

/* ================================================================
   Structure
   ================================================================ */
// - Types: AuthorizationResult
// - Zod boundary: AuthorizeDisbursementSchema (normalize + validate)
// - authorizeDisbursement(): transactional idempotent authorizer
// - Helpers: toMoneyDecimal()

/* ================================================================
   Implementation guidance
   ================================================================ */
// - Call authorizeDisbursement() after case is VERIFIED + execution COMPLETED.
// - Frontend should never set lifecycle; server asserts invariants.
// - Keep ledger commit inside same transaction as disbursement creation.
// - Execution of funds transfer MUST be separate (executeDisbursement.service.ts).

/* ================================================================
   Scalability insight
   ================================================================ */
// This pattern supports async settlement engines and retry-safe execution.
// If you later add “multi-tranche” disbursements, replace caseId unique constraint with (caseId, trancheNo) unique
// and extend idempotency keys while keeping the same ledger causality design.

///////////////////////////////////////////////////////////////////
// Capability types (CRITICAL)
///////////////////////////////////////////////////////////////////

export type AuthorizedDisbursement = {
  kind: "AUTHORIZED";
  disbursementId: string;
};

export type AuthorizationDenied = {
  kind: "DENIED";
  reason: string;
};

export type AuthorizationResult = AuthorizedDisbursement | AuthorizationDenied;

///////////////////////////////////////////////////////////////////
// Validation + normalization
///////////////////////////////////////////////////////////////////

const MoneyInputSchema = z.union([z.number(), z.string()]).transform((v) => {
  // Normalize: " 1,200.50 " -> "1200.50"
  const s = typeof v === "number" ? String(v) : v;
  return s.trim().replace(/,/g, "");
});

const AuthorizeDisbursementSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),

  type: z.nativeEnum(DisbursementType),

  // Accept number or string, but normalize into Decimal safely
  amount: MoneyInputSchema,
  currency: z.string().trim().min(1).max(8),

  payee: z.object({
    kind: z.enum(PAYEE_KINDS),
    id: z.string().trim().min(1),
  }),

  actor: z.object({
    kind: z.nativeEnum(ActorKind),
    userId: z.string().uuid().optional(),
    authorityProof: z.string().trim().min(1),
  }),
});

type AuthorizeDisbursementParams = z.infer<typeof AuthorizeDisbursementSchema>;

function toMoneyDecimal(input: string): Prisma.Decimal {
  // Enforce 2dp for currency safety (schema is Decimal(18,2))
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) {
    throw new LifecycleInvariantViolationError("INVALID_DISBURSEMENT_AMOUNT");
  }
  // Round to 2 decimals deterministically
  const fixed = (Math.round(n * 100) / 100).toFixed(2);
  return new Prisma.Decimal(fixed);
}

///////////////////////////////////////////////////////////////////
// Authorization (NO EXECUTION)
///////////////////////////////////////////////////////////////////

export async function authorizeDisbursement(
  input: unknown,
): Promise<AuthorizationResult> {
  const params = AuthorizeDisbursementSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    ////////////////////////////////////////////////////////////////
    // 1) Idempotency guard — one disbursement per case (current schema)
    ////////////////////////////////////////////////////////////////
    const existing = await tx.disbursement.findUnique({
      where: { caseId: params.caseId }, // caseId is @unique in your schema
      select: { id: true, status: true },
    });

    if (existing) {
      // If already authorized, return stable result. Otherwise deny (do not mutate here).
      if (existing.status === DisbursementStatus.AUTHORIZED) {
        return { kind: "AUTHORIZED", disbursementId: existing.id };
      }
      return {
        kind: "DENIED",
        reason: `Disbursement already exists in status=${existing.status}`,
      };
    }

    ////////////////////////////////////////////////////////////////
    // 2) Load authoritative facts (tenant scoped)
    ////////////////////////////////////////////////////////////////
    const c = await tx.case.findFirst({
      where: { id: params.caseId, tenantId: params.tenantId },
      include: {
        execution: true,
        verificationRecords: {
          where: { consensusReached: true },
          orderBy: { verifiedAt: "desc" }, // latest consensus first
          take: 1,
        },
      },
    });

    if (!c) throw new LifecycleInvariantViolationError("CASE_NOT_FOUND");

    ////////////////////////////////////////////////////////////////
    // 3) Hard preconditions (absolute)
    ////////////////////////////////////////////////////////////////
    if (c.lifecycle !== CaseLifecycle.VERIFIED) {
      throw new LifecycleInvariantViolationError("CASE_NOT_VERIFIED");
    }

    if (!c.execution) {
      throw new LifecycleInvariantViolationError("EXECUTION_MISSING");
    }

    if (c.execution.status !== ExecutionStatus.COMPLETED) {
      throw new LifecycleInvariantViolationError("EXECUTION_NOT_COMPLETED");
    }

    const verificationRecord = c.verificationRecords[0];
    if (!verificationRecord) {
      throw new LifecycleInvariantViolationError("NO_CONSENSUS_VERIFICATION");
    }

    ////////////////////////////////////////////////////////////////
    // 4) Create AUTHORIZED disbursement (NO execution)
    ////////////////////////////////////////////////////////////////
    const amount = toMoneyDecimal(params.amount);

    const disbursement = await tx.disbursement.create({
      data: {
        tenantId: params.tenantId,
        caseId: params.caseId,

        type: params.type,
        status: DisbursementStatus.AUTHORIZED,

        amount,
        currency: params.currency,

        payeeKind: params.payee.kind,
        payeeId: params.payee.id,

        actorKind: params.actor.kind,
        actorUserId: params.actor.userId ?? null,
        authorityProof: params.actor.authorityProof,

        verificationRecordId: verificationRecord.id,
        executionId: c.execution.id,
      },
      select: { id: true },
    });

    ////////////////////////////////////////////////////////////////
    // 5) Ledger causality — authorization
    ////////////////////////////////////////////////////////////////
    await commitLedgerEvent(
      {
        tenantId: params.tenantId,
        caseId: params.caseId,
        eventType: LedgerEventType.DISBURSEMENT_AUTHORIZED,
        actor: {
          kind: params.actor.kind,
          userId:
            params.actor.kind === ActorKind.HUMAN
              ? params.actor.userId
              : undefined,
          authorityProof: params.actor.authorityProof,
        },
        payload: buildAuthorityEnvelopeV1({
          domain: "DISBURSEMENT",
          event: "AUTHORIZED",
          data: {
            disbursementId: disbursement.id,
            amount: amount.toString(), // ledger payload should be string-safe
            currency: params.currency,
            destination: params.payee,
            verificationRecordId: verificationRecord.id,
            executionId: c.execution.id,
          },
        }),
      },
      tx,
    );

    return { kind: "AUTHORIZED", disbursementId: disbursement.id };
  });
}

///////////////////////////////////////////////////////////////////
// Example usage
///////////////////////////////////////////////////////////////////
/*
await authorizeDisbursement({
  tenantId,
  caseId,
  type: "CASH", // DisbursementType
  amount: "1200.50",
  currency: "GHS",
  payee: { kind: "USER", id: beneficiaryUserId },
  actor: { kind: "HUMAN", userId: staffUserId, authorityProof: `HUMAN:${staffUserId}:DISBURSE_AUTH` },
});
*/

///////////////////////////////////////////////////////////////////
// Integration notes
///////////////////////////////////////////////////////////////////
// - Requires Case.lifecycle to reach VERIFIED via DecisionService workflow.
// - Requires Execution.status to be COMPLETED.
// - Requires at least one VerificationRecord(consensusReached=true) for the case.
// - Disbursement.amount is Prisma Decimal(18,2) so always send amount as number/string and let this service normalize.
