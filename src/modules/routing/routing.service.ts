// apps/backend/src/modules/routing/routing.service.ts
// Sovereign Phase 1.5 routing service.
// Deterministic, multi-tenant scoped, ledger-authoritative, lifecycle-neutral.

import { prisma } from "@/lib/prisma";
import { RoutingOutcome, Prisma } from "@prisma/client";
import { z } from "zod";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { commitRoutingLedger } from "./commitRoutingLedger";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const RouteCaseSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  intentCode: z.string().min(1),
});

const CapabilitiesSchema = z.object({
  sdgGoals: z.array(z.string()),
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
   * - Must be tenant-scoped
   * - Must commit ledger event atomically
   */
  async routeCase(input: unknown) {
    const { tenantId, caseId, intentCode } = RouteCaseSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Ensure case exists (tenant scoped)
      ////////////////////////////////////////////////////////////////

      const c = await tx.case.findFirstOrThrow({
        where: { id: caseId, tenantId },
        select: { id: true, sdgGoal: true },
      });

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Fetch execution bodies (tenant scoped)
      ////////////////////////////////////////////////////////////////

      const bodies = await tx.executionBody.findMany({
        where: { tenantId },
        select: {
          id: true,
          capabilities: true,
          isFallback: true,
        },
      });

      if (bodies.length === 0) {
        throw new Error("NO_EXECUTION_BODIES_REGISTERED");
      }

      ////////////////////////////////////////////////////////////////
      // 3️⃣ Deterministic matching
      ////////////////////////////////////////////////////////////////

      const matched = bodies.find((b) =>
        this.matchesIntent(b.capabilities, c.sdgGoal),
      );

      const fallback = bodies.find((b) => b.isFallback === true);

      let chosenBodyId: string;
      let outcome: RoutingOutcome;

      if (matched) {
        chosenBodyId = matched.id;
        outcome = RoutingOutcome.MATCHED;
      } else if (fallback) {
        chosenBodyId = fallback.id;
        outcome = RoutingOutcome.FALLBACK;
      } else {
        // No silent assignment.
        throw new Error("ROUTING_UNASSIGNABLE_NO_FALLBACK");
      }

      ////////////////////////////////////////////////////////////////
      // 4️⃣ Persist routing decision snapshot
      ////////////////////////////////////////////////////////////////

      await tx.routingDecision.create({
        data: {
          tenantId,
          caseId,
          routingOutcome: outcome,
          chosenExecutionBodyId: chosenBodyId,
        },
      });

      ////////////////////////////////////////////////////////////////
      // 5️⃣ Ledger commit (atomic with tx)
      ////////////////////////////////////////////////////////////////

      await commitRoutingLedger(
        this.ledger,
        {
          tenantId,
          caseId,
          intentCode,
          routingResult: {
            executionBodyId: chosenBodyId,
            outcome,
            reason:
              outcome === RoutingOutcome.MATCHED
                ? "MATCHED"
                : "FALLBACK_NO_MATCH",
          },
        },
        tx as Prisma.TransactionClient,
      );

      return {
        executionBodyId: chosenBodyId,
        outcome,
      };
    });
  }

  ////////////////////////////////////////////////////////////////
  // Deterministic Intent Matching
  ////////////////////////////////////////////////////////////////

  private matchesIntent(
    capabilities: unknown,
    sdgGoal: string | null,
  ): boolean {
    if (!sdgGoal) return false;

    const parsed = CapabilitiesSchema.safeParse(capabilities);

    if (!parsed.success) return false;

    return parsed.data.sdgGoals.includes(sdgGoal);
  }
}
