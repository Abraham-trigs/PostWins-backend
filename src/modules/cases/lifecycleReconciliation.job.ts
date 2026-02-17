// src/modules/cases/lifecycleReconciliation.job.ts
// Scheduled lifecycle projection integrity job (ledger-authoritative governance sweep).

import { prisma } from "../../lib/prisma";
import { LifecycleReconciliationService } from "./lifecycleReconciliation.service";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";

////////////////////////////////////////////////////////////////
// Service Wiring
////////////////////////////////////////////////////////////////

const ledgerService = new LedgerService();
const reconciliationService = new LifecycleReconciliationService(ledgerService);

////////////////////////////////////////////////////////////////
// Job
////////////////////////////////////////////////////////////////

export async function runLifecycleReconciliationJob(): Promise<void> {
  console.info(
    "[LifecycleReconciliationJob] Starting lifecycle integrity sweep...",
  );

  const tenants = await prisma.tenant.findMany({
    select: { id: true },
  });

  let totalCases = 0;
  let totalDrift = 0;
  let totalRepaired = 0;

  for (const tenant of tenants) {
    const cases = await prisma.case.findMany({
      where: { tenantId: tenant.id },
      select: { id: true },
    });

    for (const c of cases) {
      totalCases++;

      const result = await reconciliationService.reconcileCaseLifecycle(
        tenant.id,
        c.id,
      );

      if (result.driftDetected) totalDrift++;
      if (result.repaired) totalRepaired++;
    }
  }

  console.info(
    `[LifecycleReconciliationJob] Completed. Cases=${totalCases}, DriftDetected=${totalDrift}, Repaired=${totalRepaired}`,
  );
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Ledger is canonical truth.
// Case.lifecycle is a projection.
// This job replays immutable facts and repairs drift atomically.
// It does not infer. It verifies.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Instantiate LedgerService
// - Inject into reconciliation service
// - Iterate tenants
// - Iterate cases per tenant
// - Reconcile case-by-case
// - Aggregate metrics

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Run via:
// - Scheduled cron (10–15 min interval)
// - Startup validation
// - Governance sweep before audits
//
// Never run per-request.
// Never block operational flow.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// This implementation is O(total cases).
// Can optimize later via:
// - Ledger checkpoint snapshots
// - Incremental reconciliation (last ledger ts)
// - Tenant sharding
//
// Deterministic replay makes horizontal scaling safe.
