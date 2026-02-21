import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import { LedgerEventType, ActorKind, Prisma } from "@prisma/client";

const RequestVerificationSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  requesterUserId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000).optional(),
});

export class VerificationRequestService {
  async requestVerification(input: unknown) {
    const parsed = RequestVerificationSchema.parse(input);
    const { tenantId, caseId, requesterUserId, reason } = parsed;

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const execution = await tx.execution.findFirst({
        where: { tenantId, caseId },
        select: { status: true },
      });

      if (!execution || execution.status !== "COMPLETED") {
        throw new Error("VERIFICATION_REQUEST_REQUIRES_COMPLETED_EXECUTION");
      }

      await commitLedgerEvent(
        {
          tenantId,
          caseId,
          eventType: LedgerEventType.VERIFICATION_REQUESTED,
          actor: {
            kind: ActorKind.HUMAN,
            userId: requesterUserId,
            authorityProof: "FORMAL_VERIFICATION_REQUEST",
          },
          payload: buildAuthorityEnvelopeV1({
            domain: "VERIFICATION",
            event: "VERIFICATION_REQUESTED",
            data: { reason },
          }),
        },
        tx,
      );

      return { success: true };
    });
  }
}
