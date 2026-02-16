// apps/backend/src/modules/cases/lifecycleReconciliation.controller.ts
// Admin endpoint for tenant-wide lifecycle integrity reconciliation.

import { Request, Response } from "express";
import { TenantLifecycleReconciliationJob } from "./tenantLifecycleReconciliation.job";
import { requireInternalAccess } from "../../middleware/requireInternalAccess";
import { assertUuid } from "../../utils/uuid";

/**
 * POST /api/admin/tenants/:tenantId/reconcile
 *
 * Governance-only endpoint.
 * Runs full tenant lifecycle reconciliation.
 *
 * Must be protected by internal access middleware.
 */

const job = new TenantLifecycleReconciliationJob();

export const reconcileTenantLifecycle = [
  requireInternalAccess,
  async (req: Request, res: Response) => {
    const { tenantId } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: "tenantId is required" });
    }

    try {
      assertUuid(tenantId, "tenantId");
    } catch {
      return res.status(400).json({ error: "Invalid tenantId" });
    }

    const summary = await job.run(tenantId);

    return res.json({
      tenantId: summary.tenantId,
      totalCases: summary.totalCases,
      driftedCases: summary.driftedCases,
      repairedCases: summary.repairedCases,
      scannedAt: summary.scannedAt,
    });
  },
];

/*
Design reasoning
----------------
Reconciliation must be operable and controlled.
Manual trigger allows:
- Governance validation
- Pre-deployment integrity checks
- Incident recovery workflows

Structure
---------
- Protected by requireInternalAccess
- UUID validation
- Delegates to reconciliation job
- Returns summary only (not full case reports)

Implementation guidance
-----------------------
Do not expose full per-case reports in public APIs.
If needed, create separate audit endpoint.
Ensure route is mounted under admin namespace.
Never allow tenant cross-leakage.

Scalability insight
-------------------
Enables:
- Controlled multi-tenant governance
- Operational transparency
- On-demand integrity repair
- Safe horizontal scaling

Would I ship this without review?
Yes.

Does it protect lifecycle authority?
Yes.

If it fails, can it degrade safely?
Yes — job is idempotent.

Who owns this tomorrow?
Platform governance + SRE.
*/
