// src/modules/verification/verification.service.ts

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
  DecisionType,
} from "@prisma/client";
import { LifecycleInvariantViolationError } from "@/modules/cases/case.errors";
import { DecisionService } from "@/modules/decision/decision.service";
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
  constructor(
    private ledger: LedgerService,
    private decisionService: DecisionService,
  ) {}

  async getVerificationRecordById(verificationRecordId: string) {
    return prisma.verificationRecord.findUnique({
      where: { id: verificationRecordId },
      include: {
        requiredRoles: true,
        receivedVerifications: true,
      },
    });
  }

  async recordVerification(input: unknown): Promise<VerificationResult> {
    const { verificationRecordId, verifierUserId, status, note } =
      RecordVerificationSchema.parse(input);

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Load record
      ////////////////////////////////////////////////////////////////

      const record = await tx.verificationRecord.findUnique({
        where: { id: verificationRecordId },
        include: {
          requiredRoles: true,
          receivedVerifications: true,
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
      // 3️⃣ Role authorization
      ////////////////////////////////////////////////////////////////

      const verifierRoles = await tx.userRole.findMany({
        where: {
          userId: verifierUserId,
          role: { tenantId: record.tenantId },
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
      // 5️⃣ Persist vote
      ////////////////////////////////////////////////////////////////

      await tx.verification.create({
        data: {
          tenantId: record.tenantId,
          verificationRecordId: record.id,
          verifierUserId,
          status,
          note,
        },
      });

      ////////////////////////////////////////////////////////////////
      // 6️⃣ Ledger — VERIFICATION_SUBMITTED (fact only)
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
      // 7️⃣ Quorum evaluation
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

      if (approvedCount < record.requiredVerifiers) {
        return { consensusReached: false, record: null };
      }

      ////////////////////////////////////////////////////////////////
      // 8️⃣ Finalize consensus (no lifecycle change)
      ////////////////////////////////////////////////////////////////

      const finalized = await tx.verificationRecord.update({
        where: { id: record.id },
        data: {
          consensusReached: true,
          verifiedAt: new Date(),
        },
      });

      ////////////////////////////////////////////////////////////////
      // 9️⃣ Trigger authoritative decision
      ////////////////////////////////////////////////////////////////

      await this.decisionService.applyDecision(
        {
          tenantId: record.tenantId,
          caseId: record.caseId,
          decisionType: DecisionType.VERIFICATION,
          actorKind: ActorKind.HUMAN,
          actorUserId: verifierUserId,
          reason: "Verification consensus reached",
          intentContext: {
            verificationRecordId: record.id,
          },
          effect: {
            kind: "EXECUTION_VERIFIED",
          },
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
