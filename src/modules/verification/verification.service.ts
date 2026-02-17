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

/**
 * Input schema for recording a verification vote.
 *
 * Strictly enforces:
 * - UUID format
 * - Enum alignment with Prisma schema
 * - Optional note payload
 *
 * Prevents drift between API boundary and DB vocabulary.
 */
const RecordVerificationSchema = z.object({
  verificationRecordId: z.string().uuid(),
  verifierUserId: z.string().uuid(),
  status: z.nativeEnum(VerificationStatus),
  note: z.string().optional(),
});

/**
 * Deterministic result contract.
 *
 * - consensusReached: whether quorum finalized
 * - record: finalized record only when consensus true
 *
 * Never mutates Case lifecycle here.
 */
type VerificationResult = {
  consensusReached: boolean;
  record: VerificationRecord | null;
};

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class VerificationService {
  constructor(private ledger: LedgerService) {}

  /**
   * Read-only loader.
   * Does not mutate state.
   */
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
   * - Never mutates Case.lifecycle
   * - Ledger commit must be atomic with DB mutation
   * - Tenant isolation must be preserved
   * - All ledger payloads must use Authority Envelope V1
   *
   * Verification is a fact-recording system.
   * Governance transition is separate.
   */
  async recordVerification(input: unknown): Promise<VerificationResult> {
    const { verificationRecordId, verifierUserId, status, note } =
      RecordVerificationSchema.parse(input);

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Load record (authoritative source of tenant + policy)
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
      // 2️⃣ Execution invariant
      // Verification may only occur after execution completion
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
      // 3️⃣ Tenant-safe role authorization
      //
      // NOTE:
      // UserRole does not carry tenantId directly.
      // Tenant isolation enforced through Role.tenantId.
      ////////////////////////////////////////////////////////////////

      const verifierRoles = await tx.userRole.findMany({
        where: {
          userId: verifierUserId,
          role: {
            tenantId: record.tenantId,
          },
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
      //
      // DB-level unique constraint is final authority.
      ////////////////////////////////////////////////////////////////

      const alreadyVoted = record.receivedVerifications.some(
        (v) => v.verifierUserId === verifierUserId,
      );

      if (alreadyVoted) {
        throw new Error("Verifier has already voted");
      }

      ////////////////////////////////////////////////////////////////
      // 5️⃣ Persist vote (fact recording)
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
      // 6️⃣ Ledger appendEntry — VERIFICATION_SUBMITTED
      //
      // Atomic with DB mutation.
      // Envelope V1 protects replay determinism.
      ////////////////////////////////////////////////////////////////

      await this.ledger.appendEntry(
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
      // 7️⃣ Deterministic quorum evaluation
      //
      // IMPORTANT:
      // Rejection does NOT auto-block unless quorum reached.
      // This maintains consistency with consensus evaluator.
      ////////////////////////////////////////////////////////////////

      const [approvedCount, rejectedCount] = await Promise.all([
        tx.verification.count({
          where: {
            verificationRecordId: record.id,
            status: VerificationStatus.APPROVED,
          },
        }),
        tx.verification.count({
          where: {
            verificationRecordId: record.id,
            status: VerificationStatus.REJECTED,
          },
        }),
      ]);

      // Rejection quorum reached
      if (rejectedCount >= record.requiredVerifiers) {
        return {
          consensusReached: false,
          record: null,
        };
      }

      // Approval quorum not yet met
      if (approvedCount < record.requiredVerifiers) {
        return {
          consensusReached: false,
          record: null,
        };
      }

      ////////////////////////////////////////////////////////////////
      // 8️⃣ Finalize consensus
      //
      // Only consensus flag is mutated.
      // Case lifecycle remains untouched.
      ////////////////////////////////////////////////////////////////

      const finalized = await tx.verificationRecord.update({
        where: { id: record.id },
        data: {
          consensusReached: true,
          verifiedAt: new Date(),
        },
      });

      ////////////////////////////////////////////////////////////////
      // 9️⃣ Ledger commit — VERIFIED
      ////////////////////////////////////////////////////////////////

      await this.ledger.appendEntry(
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
              approvedCount,
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
Verification records facts.
Governance transitions occur elsewhere.

Two ledger events:
- VERIFICATION_SUBMITTED (vote recorded)
- VERIFIED (consensus reached)

Both atomic with DB mutation.
Replay must reconstruct full voting history.

Tenant isolation enforced at role boundary.
Authority Envelope V1 ensures replay-safe evolution.

Structure
---------
1. Zod validation
2. Load record
3. Enforce execution invariant
4. Tenant-safe role authorization
5. Prevent duplicate vote
6. Persist vote
7. Commit VERIFICATION_SUBMITTED
8. Deterministic quorum evaluation
9. Finalize consensus
10. Commit VERIFIED

Scalability insight
-------------------
- Fully replayable vote history
- Deterministic quorum reconstruction
- No cross-tenant privilege bleed
- Atomic authority boundary
- Versioned envelope protects institutional durability
*/
