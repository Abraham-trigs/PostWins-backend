import { prisma } from "../../lib/prisma";
import { LedgerService } from "../intake/ledger.service";
import {
  VerificationStatus,
  ActorKind,
  CaseLifecycle,
  VerificationRecord,
} from "@prisma/client";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";

type VerificationResult = {
  consensusReached: boolean;
  record: VerificationRecord | null;
};

export class VerificationService {
  constructor(private ledger: LedgerService) {}

  /**
   * Read-only retrieval of a verification record
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
   * Authoritative moment:
   * A verifier submits a vote. Consensus may be reached.
   */
  async recordVerification(
    verificationRecordId: string,
    verifierUserId: string,
    status: VerificationStatus,
    note?: string,
  ): Promise<VerificationResult> {
    return prisma.$transaction(async (tx) => {
      // 1️⃣ Load verification record
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

      // 2️⃣ Resolve verifier roles
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

      // 3️⃣ Prevent duplicate votes (fast-path check)
      const alreadyVoted = record.receivedVerifications.some(
        (v) => v.verifierUserId === verifierUserId,
      );

      if (alreadyVoted) {
        throw new Error("Verifier has already voted");
      }

      // 4️⃣ Record vote (DB-level uniqueness is authoritative)
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

      // 5️⃣ Recompute consensus (explicit semantics)
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

      // ❌ Any rejection blocks verification
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

      // 6️⃣ Finalize consensus (truth enters system)
      const finalized = await tx.verificationRecord.update({
        where: { id: record.id },
        data: {
          consensusReached: true,
          verifiedAt: new Date(),
        },
      });

      // 7️⃣ Ledger commit (authoritative fact)
      await this.ledger.commit({
        tenantId: record.tenantId,
        caseId: record.caseId,
        eventType: "VERIFIED",
        actorKind: ActorKind.HUMAN,
        actorUserId: verifierUserId,
        authorityProof: "VERIFICATION_CONSENSUS",
        payload: {
          verificationRecordId: record.id,
          requiredVerifiers: record.requiredVerifiers,
          acceptedCount,
        },
      });

      // 8️⃣ Ledger-backed lifecycle transition
      await transitionCaseLifecycleWithLedger({
        caseId: record.caseId,
        from: CaseLifecycle.ROUTED,
        to: CaseLifecycle.VERIFIED,
        actorUserId: verifierUserId,
        intentContext: {
          verificationRecordId: record.id,
        },
      });

      return {
        consensusReached: true,
        record: finalized,
      };
    });
  }
}
