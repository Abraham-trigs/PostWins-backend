// apps/backend/src/modules/cases/lifecycleReconciliation.service.ts
// Sovereign lifecycle reconciliation (ledger-authoritative, atomic, envelope-compliant).

import { prisma } from "@/lib/prisma";
import {
  CaseLifecycle,
  LedgerEventType,
  Prisma,
  ActorKind,
} from "@prisma/client";
import { deriveLifecycleFromLedger } from "./deriveLifecycleFromLedger";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
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
  private ledger: LedgerService;

  constructor(ledger?: LedgerService) {
    // Allow DI override, but default to internal instance
    this.ledger = ledger ?? new LedgerService();
  }

  async reconcileCaseLifecycle(
    inputTenantId: unknown,
    inputCaseId: unknown,
  ): Promise<LifecycleReconciliationResult> {
    const tenantId = TenantIdSchema.parse(inputTenantId);
    const caseId = CaseIdSchema.parse(inputCaseId);

    return prisma.$transaction(async (trx) => {
      const caseRow = await trx.case.findFirst({
        where: { id: caseId, tenantId },
        select: { lifecycle: true },
      });

      if (!caseRow) {
        throw new Error("Case not found");
      }

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

      await trx.case.update({
        where: { id: caseId },
        data: { lifecycle: derived },
      });

      await this.ledger.appendEntry(
        {
          tenantId,
          caseId,
          eventType: LedgerEventType.LIFECYCLE_REPAIRED,
          actorKind: ActorKind.SYSTEM,
          actorUserId: null,
          authorityProof: "SYSTEM_RECONCILIATION",
          intentContext: {
            reason: "LIFECYCLE_DRIFT_REPAIR",
          },
          payload: buildAuthorityEnvelopeV1({
            domain: "CASE_LIFECYCLE",
            event: "REPAIR",
            data: {
              previousLifecycle: stored,
              repairedTo: derived,
            },
          }),
        },
        trx,
      );

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
