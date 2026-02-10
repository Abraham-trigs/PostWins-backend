import { prisma } from "@/lib/prisma";
import { DisbursementStatus, LedgerEventType } from "@prisma/client";
import { commitLedgerEvent } from "@/modules/routing/commitRoutingLedger";

const DISBURSEMENT_EXECUTION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // policy

type ReconciliationResult = {
  scanned: number;
  stalled: number;
};

export async function reconcileDisbursements(): Promise<ReconciliationResult> {
  const now = new Date();

  // 1️⃣ Find AUTHORIZED disbursements that never executed
  const candidates = await prisma.disbursement.findMany({
    where: {
      status: DisbursementStatus.AUTHORIZED,
      authorizedAt: {
        lt: new Date(now.getTime() - DISBURSEMENT_EXECUTION_TIMEOUT_MS),
      },
    },
  });

  let stalled = 0;

  // 2️⃣ Emit ledger truth (idempotent by causality)
  for (const d of candidates) {
    try {
      await prisma.$transaction(async (tx) => {
        await commitLedgerEvent(tx, {
          tenantId: d.tenantId,
          caseId: d.caseId,
          eventType: LedgerEventType.DISBURSEMENT_STALLED,
          actor: {
            kind: "SYSTEM",
            authorityProof: "DISBURSEMENT_RECONCILIATION_JOB",
          },
          payload: {
            disbursementId: d.id,
            authorizedAt: d.authorizedAt,
            timeoutMs: DISBURSEMENT_EXECUTION_TIMEOUT_MS,
          },
        });
      });

      stalled++;
    } catch {
      // idempotency: ledger supersession or duplicate emission
      // is acceptable and expected under retries
    }
  }

  return {
    scanned: candidates.length,
    stalled,
  };
}
