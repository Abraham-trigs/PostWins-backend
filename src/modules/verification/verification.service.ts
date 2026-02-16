// src/modules/verification/verification.service.ts
// Sovereign Phase 1.5 verification service.
// Consensus-target model. No lifecycle mutation. Ledger-authoritative.

import { prisma } from "@/lib/prisma";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
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
   */
  async recordVerification(input: unknown): Promise<VerificationResult> {
    const { verificationRecordId, verifierUserId, status, note } =
      RecordVerificationSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      // 1️⃣ Load record
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

      // 🔒 Execution must be completed
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

      // 2️⃣ Role authorization
      const verifierRoles = await tx.userRole.findMany({
        where: { userId: verifierUserId },
        include: { role: true },
      });

      const allowedRoles = new Set(record.requiredRoles.map((r) => r.roleKey));

      const authorized = verifierRoles.some((ur) =>
        allowedRoles.has(ur.role.key),
      );

      if (!authorized) {
        throw new Error("User not authorized to verify this claim");
      }

      // 3️⃣ Duplicate prevention
      const alreadyVoted = record.receivedVerifications.some(
        (v) => v.verifierUserId === verifierUserId,
      );

      if (alreadyVoted) {
        throw new Error("Verifier has already voted");
      }

      // 4️⃣ Persist vote
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

      // 5️⃣ Ledger commit — VERIFICATION_SUBMITTED
      await this.ledger.commit(
        {
          tenantId: record.tenantId,
          caseId: record.caseId,
          eventType: LedgerEventType.VERIFICATION_SUBMITTED,
          actorKind: ActorKind.HUMAN,
          actorUserId: verifierUserId,
          authorityProof: "VERIFICATION_VOTE",
          payload: {
            verificationRecordId: record.id,
            status,
          },
        },
        tx as unknown as Prisma.TransactionClient,
      );

      // 6️⃣ Recompute consensus
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

      if (rejectedCount > 0) {
        throw new Error(
          "Verification rejected by at least one authorized verifier",
        );
      }

      if (acceptedCount < record.requiredVerifiers) {
        return {
          consensusReached: false,
          record: null,
        };
      }

      // 7️⃣ Finalize consensus
      const finalized = await tx.verificationRecord.update({
        where: { id: record.id },
        data: {
          consensusReached: true,
          verifiedAt: new Date(),
        },
      });

      // 8️⃣ Ledger commit — VERIFIED (atomic)
      await this.ledger.commit(
        {
          tenantId: record.tenantId,
          caseId: record.caseId,
          eventType: LedgerEventType.VERIFIED,
          actorKind: ActorKind.HUMAN,
          actorUserId: verifierUserId,
          authorityProof: "VERIFICATION_CONSENSUS",
          payload: {
            verificationRecordId: record.id,
            requiredVerifiers: record.requiredVerifiers,
            acceptedCount,
          },
        },
        tx as unknown as Prisma.TransactionClient,
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

Both must be atomic with DB writes.

Structure
---------
1. Zod validation
2. Load record
3. Enforce execution invariant
4. Authorize role
5. Prevent duplicate vote
6. Persist vote
7. Commit VERIFICATION_SUBMITTED
8. Recompute consensus
9. Finalize consensus
10. Commit VERIFIED

Implementation guidance
-----------------------
LedgerService.commit() must support optional transaction client.
Never mutate Case.lifecycle here.
Lifecycle transition is governance-layer responsibility.

Scalability insight
-------------------
- Fully replayable verification history
- Deterministic consensus reconstruction
- Atomic authority boundary
- Multi-tenant safe
*/
