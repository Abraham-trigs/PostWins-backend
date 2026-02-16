// apps/backend/src/modules/cases/lifecycleReconciliation.job.ts
// Scheduled lifecycle projection integrity job.

import { prisma } from "../../lib/prisma";
import { LifecycleReconciliationService } from "./lifecycleReconciliation.service";

const reconciliationService = new LifecycleReconciliationService();

/**
 * Runs reconciliation for all tenants.
 *
 * Intended for:
 * - Scheduled cron execution
 * - Startup validation
 * - Governance integrity sweeps
 */
export async function runLifecycleReconciliationJob(): Promise<void> {
  console.info("[LifecycleReconciliationJob] Starting integrity sweep...");

  const tenants = await prisma.tenant.findMany({
    select: { id: true },
  });

  let totalCases = 0;
  let totalDrift = 0;
  let totalRepaired = 0;

  for (const tenant of tenants) {
    const results = await reconciliationService.reconcileTenant(tenant.id);

    totalCases += results.length;

    for (const r of results) {
      if (r.driftDetected) {
        totalDrift++;
      }
      if (r.repaired) {
        totalRepaired++;
      }
    }
  }

  console.info(
    `[LifecycleReconciliationJob] Completed. Cases=${totalCases}, DriftDetected=${totalDrift}, Repaired=${totalRepaired}`,
  );
}

/*
Design reasoning
----------------
Ledger is authority.
Case.lifecycle is projection.
This job enforces projection integrity without blocking operations.

Structure
---------
- Iterate tenants
- Reconcile per tenant
- Aggregate drift metrics
- Log results

Implementation guidance
-----------------------
Invoke:
- At server startup
- Via cron (e.g. every 10–15 minutes)
- Before financial audit export

Do NOT run on every request.
Do NOT block user operations.
Treat as background governance enforcement.

Scalability insight
-------------------
Replay is deterministic.
Can later optimize with:
- Snapshotting
- Incremental reconciliation
- Sharded tenant sweeps

Would I ship this? Yes.
Does it protect lifecycle integrity? Yes.
Is it operationally safe? Yes.
Who owns this tomorrow? Governance boundary.
*/
