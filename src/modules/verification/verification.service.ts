// src/modules/verification/verification.service.ts
// Sovereign Phase 1.5 verification service.
// Consensus-target model. No lifecycle mutation. Ledger-authoritative.
// Authority Envelope V1 enforced for all ledger commits.

import { prisma } from "@/lib/prisma";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import {
  VerificationStatus,
  ActorKind,
  VerificationRecord,
  ExecutionStatus,
  LedgerEventType,
  Prisma,
} from "@prisma/client";
import { LifecycleInvariantViolationError } from "@/modules/cases/case.errors";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const RecordVerificationSchema = z.object({
  verificationRecordId: z.string().uuid(),
  verifierUserId: z.string().uuid(),
  status: z.nativeEnum(VerificationStatus),
  note: z.string().optional(),
});

type VerificationResult = {
  consensusReached: boolean;
  record: VerificationRecord | null;
};

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class VerificationService {
  constructor(private ledger: LedgerService) {}

  async getVerificationRecordById(verificationRecordId: string) {
    return prisma.verificationRecord.findUnique({
      where: { id: verificationRecordId },
      include: {
        requiredRoles: true,
        receivedVerifications: true,
      },
    });
  }

  /**
   * LAW:
   * - Records verification facts only
   * - Never mutates lifecycle
   * - Ledger commit must be atomic with DB mutation
   * - Tenant isolation must be preserved
   * - All ledger payloads must use Authority Envelope V1
   */
  async recordVerification(input: unknown): Promise<VerificationResult> {
    const { verificationRecordId, verifierUserId, status, note } =
      RecordVerificationSchema.parse(input);

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Load record (tenant-scoped via record itself)
      ////////////////////////////////////////////////////////////////

      const record = await tx.verificationRecord.findUnique({
        where: { id: verificationRecordId },
        include: {
          requiredRoles: true,
          receivedVerifications: true,
          case: true,
        },
      });

      if (!record) {
        throw new Error("Verification record not found");
      }

      if (record.consensusReached) {
        throw new Error("Verification already finalized");
      }

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Execution must be completed before verification
      ////////////////////////////////////////////////////////////////

      const execution = await tx.execution.findFirst({
        where: {
          caseId: record.caseId,
          tenantId: record.tenantId,
        },
        select: { status: true },
      });

      if (!execution || execution.status !== ExecutionStatus.COMPLETED) {
        throw new LifecycleInvariantViolationError(
          "VERIFICATION_REQUIRES_COMPLETED_EXECUTION",
        );
      }

      ////////////////////////////////////////////////////////////////
      // 3️⃣ Role authorization (tenant-safe)
      ////////////////////////////////////////////////////////////////

      const verifierRoles = await tx.userRole.findMany({
        where: {
          userId: verifierUserId,
          tenantId: record.tenantId, // 🔒 prevents cross-tenant bleed
        },
        include: { role: true },
      });

      const allowedRoles = new Set(record.requiredRoles.map((r) => r.roleKey));

      const authorized = verifierRoles.some((ur) =>
        allowedRoles.has(ur.role.key),
      );

      if (!authorized) {
        throw new Error("User not authorized to verify this claim");
      }

      ////////////////////////////////////////////////////////////////
      // 4️⃣ Prevent duplicate vote
      ////////////////////////////////////////////////////////////////

      const alreadyVoted = record.receivedVerifications.some(
        (v) => v.verifierUserId === verifierUserId,
      );

      if (alreadyVoted) {
        throw new Error("Verifier has already voted");
      }

      ////////////////////////////////////////////////////////////////
      // 5️⃣ Persist vote (DB-level uniqueness authoritative)
      ////////////////////////////////////////////////////////////////

      try {
        await tx.verification.create({
          data: {
            tenantId: record.tenantId,
            verificationRecordId: record.id,
            verifierUserId,
            status,
            note,
          },
        });
      } catch (err: any) {
        if (err.code === "P2002") {
          throw new Error("Verifier has already voted");
        }
        throw err;
      }

      ////////////////////////////////////////////////////////////////
      // 6️⃣ Ledger commit — VERIFICATION_SUBMITTED (Envelope V1)
      ////////////////////////////////////////////////////////////////

      await this.ledger.commit(
        {
          tenantId: record.tenantId,
          caseId: record.caseId,
          eventType: LedgerEventType.VERIFICATION_SUBMITTED,
          actorKind: ActorKind.HUMAN,
          actorUserId: verifierUserId,
          authorityProof: "VERIFICATION_VOTE",
          payload: buildAuthorityEnvelopeV1({
            domain: "VERIFICATION",
            event: "VERIFICATION_SUBMITTED",
            data: {
              verificationRecordId: record.id,
              status,
            },
          }),
        },
        tx,
      );

      ////////////////////////////////////////////////////////////////
      // 7️⃣ Recompute consensus deterministically
      ////////////////////////////////////////////////////////////////

      const [acceptedCount, rejectedCount] = await Promise.all([
        tx.verification.count({
          where: {
            verificationRecordId: record.id,
            status: VerificationStatus.ACCEPTED,
          },
        }),
        tx.verification.count({
          where: {
            verificationRecordId: record.id,
            status: VerificationStatus.REJECTED,
          },
        }),
      ]);

      // Any rejection blocks consensus permanently
      if (rejectedCount > 0) {
        return {
          consensusReached: false,
          record: null,
        };
      }

      if (acceptedCount < record.requiredVerifiers) {
        return {
          consensusReached: false,
          record: null,
        };
      }

      ////////////////////////////////////////////////////////////////
      // 8️⃣ Finalize consensus
      ////////////////////////////////////////////////////////////////

      const finalized = await tx.verificationRecord.update({
        where: { id: record.id },
        data: {
          consensusReached: true,
          verifiedAt: new Date(),
        },
      });

      ////////////////////////////////////////////////////////////////
      // 9️⃣ Ledger commit — VERIFIED (Envelope V1)
      ////////////////////////////////////////////////////////////////

      await this.ledger.commit(
        {
          tenantId: record.tenantId,
          caseId: record.caseId,
          eventType: LedgerEventType.VERIFIED,
          actorKind: ActorKind.HUMAN,
          actorUserId: verifierUserId,
          authorityProof: "VERIFICATION_CONSENSUS",
          payload: buildAuthorityEnvelopeV1({
            domain: "VERIFICATION",
            event: "VERIFIED",
            data: {
              verificationRecordId: record.id,
              requiredVerifiers: record.requiredVerifiers,
              acceptedCount,
            },
          }),
        },
        tx,
      );

      return {
        consensusReached: true,
        record: finalized,
      };
    });
  }
}

/*
Design reasoning
----------------
Verification is a fact-recording system.
Two ledger events exist:
- VERIFICATION_SUBMITTED (vote recorded)
- VERIFIED (consensus reached)

Both are atomic with DB writes.
Replay must reconstruct full voting history.
Tenant isolation is enforced at role resolution boundary.
Authority Envelope V1 ensures replay-safe payload evolution.

Structure
---------
1. Zod validation
2. Load record
3. Enforce execution invariant
4. Tenant-safe role authorization
5. Prevent duplicate vote
6. Persist vote
7. Commit VERIFICATION_SUBMITTED (enveloped)
8. Deterministic consensus calculation
9. Finalize consensus
10. Commit VERIFIED (enveloped)

Implementation guidance
-----------------------
LedgerService.commit() must accept Prisma.TransactionClient.
Never mutate Case.lifecycle here.
Lifecycle transition remains governance-layer responsibility.
Never remove tenantId filters from role resolution.
All future ledger commits must use Authority Envelope V1.

Scalability insight
-------------------
- Fully replayable vote history
- Deterministic consensus reconstruction
- No cross-tenant privilege bleed
- Atomic authority boundary
- Versioned envelope protects long-term institutional durability
*/
