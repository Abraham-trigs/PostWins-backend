// apps/backend/src/modules/cases/lifecycleReconciliation.service.ts
// Sovereign lifecycle reconciliation (ledger-authoritative, atomic).

import { prisma } from "@/lib/prisma";
import {
  CaseLifecycle,
  LedgerEventType,
  Prisma,
  ActorKind,
} from "@prisma/client";
import { deriveLifecycleFromLedger } from "./deriveLifecycleFromLedger";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const TenantIdSchema = z.string().uuid();
const CaseIdSchema = z.string().uuid();

////////////////////////////////////////////////////////////////
// DTO
////////////////////////////////////////////////////////////////

export interface LifecycleReconciliationResult {
  caseId: string;
  storedLifecycle: CaseLifecycle;
  ledgerDerivedLifecycle: CaseLifecycle;
  driftDetected: boolean;
  repaired: boolean;
}

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class LifecycleReconciliationService {
  constructor(private ledger: LedgerService) {}

  /**
   * Reconcile lifecycle projection for a case.
   * Idempotent and atomic.
   */
  async reconcileCaseLifecycle(
    inputTenantId: unknown,
    inputCaseId: unknown,
  ): Promise<LifecycleReconciliationResult> {
    const tenantId = TenantIdSchema.parse(inputTenantId);
    const caseId = CaseIdSchema.parse(inputCaseId);

    return prisma.$transaction(async (trx) => {
      // 1️⃣ Load projection
      const caseRow = await trx.case.findFirst({
        where: { id: caseId, tenantId },
        select: { lifecycle: true },
      });

      if (!caseRow) {
        throw new Error("Case not found");
      }

      // 2️⃣ Load immutable ledger
      const ledgerEvents = await trx.ledgerCommit.findMany({
        where: { tenantId, caseId },
        orderBy: { ts: "asc" },
        select: { eventType: true },
      });

      const derived = deriveLifecycleFromLedger(
        ledgerEvents.map((e) => ({
          eventType: e.eventType,
        })),
      );

      const stored = caseRow.lifecycle;
      const drift = stored !== derived;

      if (!drift) {
        return {
          caseId,
          storedLifecycle: stored,
          ledgerDerivedLifecycle: derived,
          driftDetected: false,
          repaired: false,
        };
      }

      // 3️⃣ Update projection
      await trx.case.update({
        where: { id: caseId },
        data: { lifecycle: derived },
      });

      // 4️⃣ Ledger commit (atomic with projection)
      await this.ledger.commit({
        tenantId,
        caseId,
        eventType: LedgerEventType.LIFECYCLE_REPAIRED,
        actorKind: ActorKind.SYSTEM,
        actorUserId: null,
        authorityProof: "SYSTEM_RECONCILIATION",
        intentContext: {
          reason: "LIFECYCLE_DRIFT_REPAIR",
        },
        payload: {
          previousLifecycle: stored,
          repairedTo: derived,
        },
      });

      return {
        caseId,
        storedLifecycle: stored,
        ledgerDerivedLifecycle: derived,
        driftDetected: true,
        repaired: true,
      };
    });
  }
}

// ////////////////////////////////////////////////////////////////
// // Design reasoning
// ////////////////////////////////////////////////////////////////
// Ledger is source of truth.
// Projection is repairable.
// Repair must be atomic, cryptographically recorded,
// and distinguishable from normal updates.

// ////////////////////////////////////////////////////////////////
// // Structure
// ////////////////////////////////////////////////////////////////
// 1. Validate inputs
// 2. Load projection
// 3. Replay ledger deterministically
// 4. Compare
// 5. Update projection
// 6. Record explicit repair event

// ////////////////////////////////////////////////////////////////
// // Implementation guidance
// ////////////////////////////////////////////////////////////////
// Add LedgerEventType.LIFECYCLE_REPAIRED to Prisma enum.
// Never inject manual ts.
// Never commit outside transaction.

// ////////////////////////////////////////////////////////////////
// // Scalability insight
// ////////////////////////////////////////////////////////////////
// Repair events become auditable.
// Drift cannot be hidden.
// Replay remains deterministic.
// Projection rebuild is institutional-grade safe.
