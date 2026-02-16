// apps/backend/src/modules/intake/ledger/ledgerMetrics.service.ts
// Read-only constitutional telemetry per tenant.
// Assumes: LedgerCommit model and LedgerEventType enum exist in Prisma schema.

import { prisma } from "@/lib/prisma";
import { LedgerEventType } from "@prisma/client";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const TenantIdSchema = z.string().uuid();

export interface TenantLedgerMetrics {
  tenantId: string;
  totalCommits: number;
  lifecycleTransitions: number;
  verificationEvents: number;
  repairEvents: number;
  supersessionCount: number;
  commitsLast24h: number;
  lastCommitTs: string | null;
}

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class LedgerMetricsService {
  ////////////////////////////////////////////////////////////////
  // Public API
  ////////////////////////////////////////////////////////////////

  public async getTenantLedgerMetrics(
    tenantIdInput: string,
  ): Promise<TenantLedgerMetrics> {
    const tenantId = TenantIdSchema.parse(tenantIdInput);

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    ////////////////////////////////////////////////////////////////
    // Aggregate counts (parallelized)
    ////////////////////////////////////////////////////////////////

    const [
      totalCommits,
      lifecycleTransitions,
      verificationEvents,
      repairEvents,
      supersessionCount,
      commitsLast24h,
      lastCommit,
    ] = await Promise.all([
      prisma.ledgerCommit.count({
        where: { tenantId },
      }),

      prisma.ledgerCommit.count({
        where: {
          tenantId,
          eventType: {
            in: [
              LedgerEventType.ROUTED,
              LedgerEventType.CASE_ACCEPTED,
              LedgerEventType.CASE_FLAGGED,
              LedgerEventType.CASE_ESCALATED,
              LedgerEventType.CASE_REJECTED,
              LedgerEventType.CASE_ARCHIVED,
              LedgerEventType.EXECUTION_STARTED,
              LedgerEventType.EXECUTION_COMPLETED,
              LedgerEventType.EXECUTION_ABORTED,
            ],
          },
        },
      }),

      prisma.ledgerCommit.count({
        where: {
          tenantId,
          eventType: {
            in: [
              LedgerEventType.VERIFIED,
              LedgerEventType.VERIFICATION_SUBMITTED,
              LedgerEventType.VERIFICATION_TIMED_OUT,
            ],
          },
        },
      }),

      prisma.ledgerCommit.count({
        where: {
          tenantId,
          eventType: LedgerEventType.LIFECYCLE_REPAIRED,
        },
      }),

      prisma.ledgerCommit.count({
        where: {
          tenantId,
          supersedesCommitId: {
            not: null,
          },
        },
      }),

      prisma.ledgerCommit.count({
        where: {
          tenantId,
          ts: {
            gte: BigInt(Math.floor(last24h.getTime())), // defensive; ts is logical clock
          },
        },
      }),

      prisma.ledgerCommit.findFirst({
        where: { tenantId },
        orderBy: { ts: "desc" },
        select: { ts: true },
      }),
    ]);

    return {
      tenantId,
      totalCommits,
      lifecycleTransitions,
      verificationEvents,
      repairEvents,
      supersessionCount,
      commitsLast24h,
      lastCommitTs: lastCommit?.ts?.toString() ?? null,
    };
  }
}

////////////////////////////////////////////////////////////////
// Example Usage
////////////////////////////////////////////////////////////////

/*
const service = new LedgerMetricsService();

const metrics = await service.getTenantLedgerMetrics(
  "00000000-0000-0000-0000-000000000000",
);

console.log(metrics);
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// This service provides constitutional telemetry without mutating
// authority state. It exposes governance density, override frequency,
// repair incidence, and recent activity signals per tenant.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod validation boundary
// - Parallel Prisma aggregate queries
// - Strict tenant scoping
// - Deterministic metric shape
// - BigInt-safe logical clock handling

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Keep this read-only.
// - Do not infer lifecycle state here.
// - If commit volume grows large, migrate to daily aggregate table.
// - Expose through internal health or admin-only endpoint.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Current design scales well for moderate commit volume due to
// indexed tenantId + ts queries. When commit volume exceeds
// millions per tenant, introduce a materialized daily metrics
// table updated via scheduler job.
////////////////////////////////////////////////////////////////
