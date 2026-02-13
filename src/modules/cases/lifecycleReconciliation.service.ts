// apps/backend/src/modules/cases/lifecycleReconciliation.service.ts
// Reconciles Case.lifecycle against authoritative ledger replay.

import { prisma } from "../../lib/prisma";
import { CaseLifecycle } from "@prisma/client";
import { deriveLifecycleFromLedger } from "./deriveLifecycleFromLedger";

export interface LifecycleDriftResult {
  caseId: string;
  storedLifecycle: CaseLifecycle;
  derivedLifecycle: CaseLifecycle;
  driftDetected: boolean;
  repaired: boolean;
}

/**
 * LifecycleReconciliationService
 *
 * Enforces ledger-authoritative lifecycle projection.
 *
 * Hybrid Mode:
 * - Ledger is authority
 * - Case.lifecycle is projection
 * - Drift is auto-repaired
 */
export class LifecycleReconciliationService {
  /**
   * Reconciles a single case.
   *
   * - Loads ordered ledger events
   * - Replays lifecycle
   * - Compares with stored lifecycle
   * - Repairs if mismatch
   */
  async reconcileCase(
    caseId: string,
    tenantId: string,
  ): Promise<LifecycleDriftResult> {
    // 1. Load stored lifecycle
    const caseRow = await prisma.case.findFirst({
      where: { id: caseId, tenantId },
      select: { lifecycle: true },
    });

    if (!caseRow) {
      throw new Error("Case not found during reconciliation.");
    }

    // 2. Load ledger events ordered strictly by ts ASC
    const ledgerEvents = await prisma.ledgerCommit.findMany({
      where: { caseId, tenantId },
      orderBy: { ts: "asc" },
      select: { eventType: true },
    });

    // 3. Derive authoritative lifecycle
    const derivedLifecycle = deriveLifecycleFromLedger(ledgerEvents);

    const storedLifecycle = caseRow.lifecycle;
    const driftDetected = storedLifecycle !== derivedLifecycle;

    let repaired = false;

    // 4. Auto-repair projection if drift exists
    if (driftDetected) {
      await prisma.case.update({
        where: { id: caseId },
        data: { lifecycle: derivedLifecycle },
      });

      repaired = true;

      // Optional: structured logging
      console.warn(
        `[Lifecycle Drift Repaired] Case ${caseId} - stored=${storedLifecycle}, derived=${derivedLifecycle}`,
      );
    }

    return {
      caseId,
      storedLifecycle,
      derivedLifecycle,
      driftDetected,
      repaired,
    };
  }

  /**
   * Reconciles all cases for a tenant.
   *
   * Use for:
   * - Scheduled integrity jobs
   * - Startup validation
   * - Governance audit runs
   */
  async reconcileTenant(tenantId: string): Promise<LifecycleDriftResult[]> {
    const cases = await prisma.case.findMany({
      where: { tenantId },
      select: { id: true },
    });

    const results: LifecycleDriftResult[] = [];

    for (const c of cases) {
      const result = await this.reconcileCase(c.id, tenantId);
      results.push(result);
    }

    return results;
  }
}

/*
Design reasoning
----------------
Ledger defines lifecycle authority.
Case.lifecycle is a projection.
This service enforces projection integrity.

Structure
---------
- Single-case reconciliation
- Tenant-wide reconciliation
- Drift detection
- Controlled auto-repair

Implementation guidance
-----------------------
Run:
- After deployment
- On scheduled job (cron)
- During health checks
- Before financial disbursement flows

Never mutate ledger during reconciliation.
Only repair projection.

Scalability insight
-------------------
Deterministic replay allows:
- Horizontal scaling
- Snapshot optimization later
- Event-sourcing evolution
- Regulatory audit confidence

Would I ship this? Yes.
Does it protect lifecycle integrity? Yes.
Can it roll back safely? Yes — projection repair only.
Who owns this tomorrow? Governance boundary.
*/
