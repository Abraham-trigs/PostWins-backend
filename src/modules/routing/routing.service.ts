// apps/backend/src/modules/routing/routing.service.ts
// Sovereign routing service.
// Deterministic, idempotent, multi-tenant scoped, ledger-authoritative.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { commitRoutingLedger } from "./commitRoutingLedger";
import { computeRouting } from "./computeRouting";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const RouteCaseSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  intentCode: z.string().min(1),
});

export type RouteCaseParams = z.infer<typeof RouteCaseSchema>;

////////////////////////////////////////////////////////////////
// Routing Service
////////////////////////////////////////////////////////////////

export class RoutingService {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * LAW:
   * - Does NOT mutate lifecycle
   * - Tenant-scoped
   * - Deterministic
   * - Idempotent
   * - Ledger commit atomic
   */
  async routeCase(input: unknown) {
    const { tenantId, caseId, intentCode } = RouteCaseSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Ensure case exists
      ////////////////////////////////////////////////////////////////

      await tx.case.findFirstOrThrow({
        where: { id: caseId, tenantId },
        select: { id: true },
      });

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Idempotency
      ////////////////////////////////////////////////////////////////

      const existing = await tx.routingDecision.findFirst({
        where: { tenantId, caseId },
        orderBy: { decidedAt: "desc" },
      });

      if (existing) {
        return {
          executionBodyId: existing.chosenExecutionBodyId,
          outcome: existing.routingOutcome,
        };
      }

      ////////////////////////////////////////////////////////////////
      // 3️⃣ Load execution bodies (tenant-scoped)
      ////////////////////////////////////////////////////////////////

      const bodies = await tx.executionBody.findMany({
        where: { tenantId },
        select: {
          id: true,
          capabilities: true,
          isFallback: true,
        },
      });

      ////////////////////////////////////////////////////////////////
      // 4️⃣ Prepare deterministic candidates
      ////////////////////////////////////////////////////////////////

      const candidates = bodies.map((b) => ({
        id: b.id,
        supportsIntent: (code: string) => {
          if (!b.capabilities || typeof b.capabilities !== "object")
            return false;

          const goals = (b.capabilities as any).sdgGoals ?? [];
          return Array.isArray(goals) && goals.includes(code);
        },
      }));

      const fallback = bodies.find((b) => b.isFallback === true);

      ////////////////////////////////////////////////////////////////
      // 5️⃣ Canonical routing computation
      ////////////////////////////////////////////////////////////////

      const result = computeRouting({
        intentCode,
        candidateExecutionBodies: candidates,
        fallbackExecutionBodyId: fallback?.id,
      });

      ////////////////////////////////////////////////////////////////
      // 6️⃣ Persist routing snapshot
      ////////////////////////////////////////////////////////////////

      await tx.routingDecision.create({
        data: {
          tenantId,
          caseId,
          routingOutcome: result.outcome,
          chosenExecutionBodyId: result.executionBodyId,
        },
      });

      ////////////////////////////////////////////////////////////////
      // 7️⃣ Ledger commit (atomic)
      ////////////////////////////////////////////////////////////////

      await commitRoutingLedger(
        this.ledger,
        {
          tenantId,
          caseId,
          intentCode,
          routingResult: result,
        },
        tx as Prisma.TransactionClient,
      );

      return {
        executionBodyId: result.executionBodyId,
        outcome: result.outcome,
      };
    });
  }
}
