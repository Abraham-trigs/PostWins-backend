// filepath: apps/backend/src/modules/verification/verification.service.ts
// Purpose: Record verification votes, enforce authorization + invariants, commit authoritative ledger facts, and trigger decisions.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Verification is governance: votes must be durable, auditable, and replayable.
// This service enforces:
// - execution completion invariant
// - verifier role authorization via requiredRoles
// - duplicate vote prevention
// - ledger fact emission through the single constitutional commit entrypoint (commitLedgerEvent)
// - decision orchestration upon consensus (no UI-driven lifecycle mutation)

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - VerificationService
//   - getVerificationRecordById()
//   - recordVerification()

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Always call recordVerification() inside HTTP controller with idempotencyGuard.
// - Ensure VerificationRequestService creates requiredRoles before voting begins.
// - Ledger commits must go through commitLedgerEvent (single entrypoint), not LedgerService.appendEntry.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Centralizing commitLedgerEvent usage allows adding tracing, metrics,
// and additional ledger invariants without touching each domain service.
// You can extend quorum logic (e.g., weighted roles, stake, conflict disclosures) here safely.

import { prisma } from "@/lib/prisma";
import { z } from "zod";

import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";

import {
  ActorKind,
  DecisionType,
  ExecutionStatus,
  LedgerEventType,
  Prisma,
  VerificationRecord,
  VerificationStatus,
} from "@prisma/client";

import { LifecycleInvariantViolationError } from "@/modules/cases/case.errors";
import { DecisionService } from "@/modules/decision/decision.service";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const RecordVerificationSchema = z.object({
  verificationRecordId: z.string().uuid(),
  verifierUserId: z.string().uuid(),
  status: z.nativeEnum(VerificationStatus),
  note: z.string().max(4000).optional(),
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
    // NOTE: LedgerService is intentionally not injected here anymore.
    // All commits must go through commitLedgerEvent to prevent API drift.
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

      if (!record) throw new Error("Verification record not found");
      if (record.consensusReached)
        throw new Error("Verification already finalized");

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Execution invariant (must be completed)
      ////////////////////////////////////////////////////////////////

      const execution = await tx.execution.findFirst({
        where: { caseId: record.caseId, tenantId: record.tenantId },
        select: { status: true },
      });

      if (!execution || execution.status !== ExecutionStatus.COMPLETED) {
        throw new LifecycleInvariantViolationError(
          "VERIFICATION_REQUIRES_COMPLETED_EXECUTION",
        );
      }

      ////////////////////////////////////////////////////////////////
      // 3️⃣ Role authorization (verifier must hold one of required roles)
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
      if (!authorized)
        throw new Error("User not authorized to verify this claim");

      ////////////////////////////////////////////////////////////////
      // 4️⃣ Prevent duplicate vote
      ////////////////////////////////////////////////////////////////

      const alreadyVoted = record.receivedVerifications.some(
        (v) => v.verifierUserId === verifierUserId,
      );
      if (alreadyVoted) throw new Error("Verifier has already voted");

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
      // 6️⃣ Ledger — VERIFICATION_SUBMITTED (fact only) via commitLedgerEvent
      ////////////////////////////////////////////////////////////////
      // AuthorityProof: keep minimal + deterministic. If you later want idempotency binding,
      // pass idempotency meta from controller into recordVerification input.

      await commitLedgerEvent(
        {
          tenantId: record.tenantId,
          caseId: record.caseId,
          eventType: LedgerEventType.VERIFICATION_SUBMITTED,
          actor: {
            kind: ActorKind.HUMAN,
            userId: verifierUserId,
            authorityProof: `HUMAN:${verifierUserId}:VERIFICATION_VOTE`,
          },
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

      // NOTE: Currently quorum is “approvedCount >= requiredVerifiers”.
      // rejectedCount is computed for future policy expansion (e.g., early fail thresholds).
      void rejectedCount;

      if (approvedCount < record.requiredVerifiers) {
        return { consensusReached: false, record: null };
      }

      ////////////////////////////////////////////////////////////////
      // 8️⃣ Finalize consensus (no lifecycle change here)
      ////////////////////////////////////////////////////////////////

      const finalized = await tx.verificationRecord.update({
        where: { id: record.id },
        data: {
          consensusReached: true,
          verifiedAt: new Date(),
        },
      });

      ////////////////////////////////////////////////////////////////
      // 9️⃣ Trigger authoritative decision (state transitions live in decision domain)
      ////////////////////////////////////////////////////////////////

      await this.decisionService.applyDecision(
        {
          tenantId: record.tenantId,
          caseId: record.caseId,
          decisionType: DecisionType.VERIFICATION,
          actorKind: ActorKind.HUMAN,
          actorUserId: verifierUserId,
          reason: "Verification consensus reached",
          intentContext: { verificationRecordId: record.id },
          effect: { kind: "EXECUTION_VERIFIED" },
        },
        tx,
      );

      return { consensusReached: true, record: finalized };
    });
  }
}

////////////////////////////////////////////////////////////////
// Example usage (service-level)
////////////////////////////////////////////////////////////////
/*
const svc = new VerificationService(decisionService);
await svc.recordVerification({
  verificationRecordId,
  verifierUserId,
  status: VerificationStatus.APPROVED,
  note: "Reviewed documents, looks valid.",
});
*/
