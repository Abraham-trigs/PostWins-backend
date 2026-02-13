import { prisma } from "@/lib/prisma";
import { DisbursementStatus } from "@prisma/client";
import { executeDisbursement } from "./executeDisbursement.service";

export async function reconcileDisbursement(
  disbursementId: string,
): Promise<void> {
  const disbursement = await prisma.disbursement.findUnique({
    where: { id: disbursementId },
    select: {
      id: true,
      status: true,
    },
  });

  if (!disbursement) {
    return;
  }

  // 🔒 Hard guard: execution-only, authorized-only
  if (disbursement.status !== DisbursementStatus.AUTHORIZED) {
    return;
  }

  await executeDisbursement({ disbursementId });
}
