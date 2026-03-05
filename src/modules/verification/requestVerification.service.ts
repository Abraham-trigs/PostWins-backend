// filepath: apps/backend/src/modules/verification/requestVerification.service.ts
// Purpose: Create/ensure a VerificationRecord round and commit VERIFICATION_REQUESTED to the ledger atomically.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Verification “request” is a governance boundary.
// It must create a new VerificationRecord round (multi-round supported) and commit a ledger fact in the same tx.
// We also prevent duplicate open rounds (consensusReached=false) for the same case to avoid spam + drift.
// Required role keys are stored on the record for authorization during voting.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod validation boundary
// - ensureVerificationRound(): creates/returns an open VerificationRecord
// - requestVerification(): convenience wrapper (manual request flavor)
// - All writes are transaction-aware and accept optional tx

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Controllers should call requestVerification(...) inside their own transaction when they also create messages.
// - Always pass idempotency metadata into authorityProof when available.
// - Keep consensus logic in VerificationService.recordVerification().

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// By centralizing “open round” detection here, you can later add throttling,
// escalation, SLA timers, verifier assignment, and notification fanout without changing controllers.

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma, LedgerEventType, ActorKind } from "@prisma/client";

import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const EnsureVerificationRoundSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),

  // Multi-round semantics: different triggers can create different rounds.
  trigger: z
    .enum(["INTAKE", "DELIVERY", "FOLLOWUP", "GRANT_CONDITION", "MANUAL"])
    .default("MANUAL"),

  requiredRoleKeys: z.array(z.string().min(1)).min(1),
  requiredVerifiers: z.number().int().min(1).max(50).default(2),

  requestedBy: z.union([
    z.object({ kind: z.literal("SYSTEM") }),
    z.object({ kind: z.literal("USER"), userId: z.string().uuid() }),
  ]),

  reason: z.string().trim().min(1).max(2000).optional(),

  // Optional idempotency metadata to strengthen authority proof
  idempotency: z
    .object({
      key: z.string().min(1),
      requestHash: z.string().min(1),
    })
    .optional(),
});

export type EnsureVerificationRoundInput = z.infer<
  typeof EnsureVerificationRoundSchema
>;

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class VerificationRequestService {
  /**
   * Ensures there is exactly one OPEN verification round for a case at a time.
   * Returns the open round (existing or newly created).
   */

  async ensureVerificationRound(input: unknown, tx?: Prisma.TransactionClient) {
    const parsed = EnsureVerificationRoundSchema.parse(input);

    const execute = async (t: Prisma.TransactionClient) => {
      // Prevent duplicate open rounds
      const open = await t.verificationRecord.findFirst({
        where: {
          tenantId: parsed.tenantId,
          caseId: parsed.caseId,
          consensusReached: false,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (open) {
        return {
          created: false as const,
          verificationRecordId: open.id,
        };
      }

      // Create new round
      const record = await t.verificationRecord.create({
        data: {
          tenantId: parsed.tenantId,
          caseId: parsed.caseId,
          requiredVerifiers: parsed.requiredVerifiers,
          consensusReached: false,
          routedAt: new Date(),
        },
        select: { id: true },
      });

      // Attach required role keys
      await t.verificationRequiredRole.createMany({
        data: parsed.requiredRoleKeys.map((roleKey) => ({
          verificationRecordId: record.id,
          roleKey,
        })),
        skipDuplicates: true,
      });

      // Ledger actor
      const actor =
        parsed.requestedBy.kind === "USER"
          ? {
              kind: ActorKind.HUMAN,
              userId: parsed.requestedBy.userId,
              authorityProof: parsed.idempotency
                ? `HUMAN:${parsed.requestedBy.userId}:${parsed.idempotency.key}:${parsed.idempotency.requestHash}`
                : `HUMAN:${parsed.requestedBy.userId}:VERIFICATION_REQUEST`,
            }
          : {
              kind: ActorKind.SYSTEM,
              authorityProof: parsed.idempotency
                ? `SYSTEM:${parsed.idempotency.key}:${parsed.idempotency.requestHash}`
                : `SYSTEM:VERIFICATION_REQUEST`,
            };

      await commitLedgerEvent(
        {
          tenantId: parsed.tenantId,
          caseId: parsed.caseId,
          eventType: LedgerEventType.VERIFICATION_REQUESTED,
          actor,
          intentContext: parsed.idempotency
            ? {
                idempotencyKey: parsed.idempotency.key,
                requestHash: parsed.idempotency.requestHash,
              }
            : undefined,
          payload: buildAuthorityEnvelopeV1({
            domain: "VERIFICATION",
            event: "VERIFICATION_REQUESTED",
            data: {
              verificationRecordId: record.id,
              trigger: parsed.trigger,
              requiredRoleKeys: parsed.requiredRoleKeys,
              requiredVerifiers: parsed.requiredVerifiers,
              reason: parsed.reason ?? null,
            },
          }),
        },
        t,
      );

      return {
        created: true as const,
        verificationRecordId: record.id,
      };
    };

    // If caller already has a transaction → reuse it
    if (tx) {
      return execute(tx);
    }

    // Otherwise open one
    return prisma.$transaction(execute);
  }
  /**
   * Convenience wrapper for MANUAL requests.
   */
  async requestVerification(
    input: {
      tenantId: string;
      caseId: string;
      requesterUserId: string;
      reason?: string;
      requiredRoleKeys?: string[];
      requiredVerifiers?: number;
      idempotency?: { key: string; requestHash: string };
    },
    tx?: Prisma.TransactionClient,
  ) {
    return this.ensureVerificationRound(
      {
        tenantId: input.tenantId,
        caseId: input.caseId,
        trigger: "MANUAL",
        requiredRoleKeys: input.requiredRoleKeys ?? ["NGO_PARTNER", "STAFF"],
        requiredVerifiers: input.requiredVerifiers ?? 2,
        requestedBy: { kind: "USER", userId: input.requesterUserId },
        reason: input.reason,
        idempotency: input.idempotency,
      },
      tx,
    );
  }
}

////////////////////////////////////////////////////////////////
// Example usage
////////////////////////////////////////////////////////////////
/*
const svc = new VerificationRequestService();
await svc.requestVerification({
  tenantId,
  caseId,
  requesterUserId,
  reason: "Please verify enrollment milestone",
  requiredRoleKeys: ["NGO_PARTNER", "STAFF"],
  requiredVerifiers: 2,
  idempotency: { key, requestHash },
});
*/
