// apps/backend/src/modules/cases/tenantLifecycleReconciliation.job.ts
// Tenant-wide lifecycle integrity scan + repair job (sovereign-safe).

import { prisma } from "@/lib/prisma";
import { LifecycleReconciliationService } from "./lifecycleReconciliation.service";
import { CaseLifecycle } from "@prisma/client";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const TenantIdSchema = z.string().uuid();

////////////////////////////////////////////////////////////////
// Per-case reconciliation outcome
////////////////////////////////////////////////////////////////

export interface TenantCaseReconciliationReport {
  caseId: string;
  storedLifecycle: CaseLifecycle;
  ledgerDerivedLifecycle: CaseLifecycle;
  driftDetected: boolean;
  repaired: boolean;
}

////////////////////////////////////////////////////////////////
// Tenant-wide reconciliation summary
////////////////////////////////////////////////////////////////

export interface TenantReconciliationSummary {
  tenantId: string;
  totalCases: number;
  driftedCases: number;
  repairedCases: number;
  scannedAt: number;
  reports: TenantCaseReconciliationReport[];
}

////////////////////////////////////////////////////////////////
// Job
////////////////////////////////////////////////////////////////

export class TenantLifecycleReconciliationJob {
  private reconciliationService = new LifecycleReconciliationService();

  /**
   * Execute reconciliation scan for a tenant.
   *
   * LAW:
   * - Ledger immutable
   * - Projection repairable
   * - Repairs ledger-authoritative
   * - Idempotent and repeatable
   */
  async run(inputTenantId: unknown): Promise<TenantReconciliationSummary> {
    const tenantId = TenantIdSchema.parse(inputTenantId);
    const scannedAt = Date.now();

    const cases = await prisma.case.findMany({
      where: { tenantId },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    const reports: TenantCaseReconciliationReport[] = [];

    let driftedCases = 0;
    let repairedCases = 0;

    // Sequential on purpose: protects ledger ordering and DB pressure
    for (const c of cases) {
      const result = await this.reconciliationService.reconcileCaseLifecycle(
        tenantId,
        c.id,
      );

      reports.push(result);

      if (result.driftDetected) driftedCases++;
      if (result.repaired) repairedCases++;
    }

    return {
      tenantId,
      totalCases: cases.length,
      driftedCases,
      repairedCases,
      scannedAt,
      reports,
    };
  }
}

// ////////////////////////////////////////////////////////////////
// // Design reasoning
// ////////////////////////////////////////////////////////////////
// Projection drift is inevitable in distributed systems.
// Ledger is sovereign; projection must be repairable.
// Tenant-scoped reconciliation guarantees:
// - Deterministic rebuild
// - Audit continuity
// - Idempotent correction

// ////////////////////////////////////////////////////////////////
// // Structure
// ////////////////////////////////////////////////////////////////
// 1. Validate tenantId
// 2. Fetch tenant cases (ordered)
// 3. Sequential reconciliation
// 4. Aggregate metrics
// 5. Return structured summary

// ////////////////////////////////////////////////////////////////
// // Implementation guidance
// ////////////////////////////////////////////////////////////////
// Do NOT parallelize without explicit ledger-safe strategy.
// Use batching if tenant case count becomes very large.
// Safe to expose behind admin authentication.
// Never mutate ledger directly inside this job.

// ////////////////////////////////////////////////////////////////
// // Scalability insight
// ////////////////////////////////////////////////////////////////
// Sequential processing protects:
// - Global ledger sequence monotonicity
// - DB resource stability
// - Multi-tenant fairness

// This design supports:
// - Nightly compliance scans
// - Pre-release verification gates
// - Automated drift detection at scale
