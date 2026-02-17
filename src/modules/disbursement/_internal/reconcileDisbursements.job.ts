import { prisma } from "@/lib/prisma";
import { DisbursementStatus, ActorKind } from "@prisma/client";
import { executeDisbursement } from "./executeDisbursement.service";

export async function reconcileDisbursement(
  disbursementId: string,
): Promise<void> {
  const disbursement = await prisma.disbursement.findUnique({
    where: { id: disbursementId },
    select: {
      id: true,
      tenantId: true,
      status: true,
    },
  });

  if (!disbursement) {
    return;
  }

  // 🔒 Only authorized disbursements can be executed
  if (disbursement.status !== DisbursementStatus.AUTHORIZED) {
    return;
  }

  await executeDisbursement({
    tenantId: disbursement.tenantId,
    disbursementId: disbursement.id,
    actor: {
      kind: ActorKind.SYSTEM,
      userId: undefined,
      authorityProof: "SYSTEM_RECONCILIATION",
    },
    outcome: { success: true },
  });
}
