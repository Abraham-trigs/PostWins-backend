// apps/backend/src/modules/routing/routing.service.ts
// Sovereign Phase 1.5 routing service.
// Deterministic, multi-tenant scoped, ledger-authoritative, lifecycle-neutral.

import { prisma } from "@/lib/prisma";
import { RoutingOutcome, ActorKind } from "@prisma/client";
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

export type RouteCaseParams = z.infer<typeof RouteCaseSchema>;

////////////////////////////////////////////////////////////////
// Routing Service
////////////////////////////////////////////////////////////////

export class RoutingService {
  constructor(private readonly ledger: LedgerService) {}

  /**
   * Deterministic routing.
   *
   * LAW:
   * - Does NOT mutate lifecycle
   * - Does NOT infer lifecycle
   * - Must be tenant-scoped
   * - Must commit ledger event
   */
  async routeCase(input: unknown) {
    const { tenantId, caseId, intentCode } = RouteCaseSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      // 1️⃣ Ensure case exists under tenant
      const c = await tx.case.findFirstOrThrow({
        where: { id: caseId, tenantId },
        select: { id: true, sdgGoal: true },
      });

      // 2️⃣ Fetch candidate execution bodies (tenant scoped)
      const bodies = await tx.executionBody.findMany({
        where: { tenantId },
        select: {
          id: true,
          capabilities: true,
          isFallback: true,
        },
      });

      if (!bodies.length) {
        throw new Error("NO_EXECUTION_BODIES_REGISTERED");
      }

      // 3️⃣ Deterministic matching
      const matched = bodies.find((b) =>
        this.matchesIntent(b.capabilities, c.sdgGoal),
      );

      const fallback = bodies.find((b) => b.isFallback);

      let chosenBodyId: string;
      let outcome: RoutingOutcome;

      if (matched) {
        chosenBodyId = matched.id;
        outcome = RoutingOutcome.MATCHED;
      } else if (fallback) {
        chosenBodyId = fallback.id;
        outcome = RoutingOutcome.FALLBACK;
      } else {
        chosenBodyId = bodies[0].id;
        outcome = RoutingOutcome.UNASSIGNED;
      }

      // 4️⃣ Persist routing decision snapshot
      await tx.routingDecision.create({
        data: {
          tenantId,
          caseId,
          routingOutcome: outcome,
          chosenExecutionBodyId: chosenBodyId,
        },
      });

      // 5️⃣ Commit ledger (authoritative record)
      await commitRoutingLedger(this.ledger, {
        tenantId,
        caseId,
        intentCode,
        routingResult: {
          executionBodyId: chosenBodyId,
          outcome,
          reason:
            outcome === RoutingOutcome.MATCHED
              ? "MATCHED"
              : outcome === RoutingOutcome.FALLBACK
                ? "FALLBACK_NO_MATCH"
                : "UNASSIGNED",
        },
      });

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

    if (
      capabilities &&
      typeof capabilities === "object" &&
      Array.isArray((capabilities as any).sdgGoals)
    ) {
      return (capabilities as any).sdgGoals.includes(sdgGoal);
    }

    return false;
  }
}

// ////////////////////////////////////////////////////////////////
// // Example Usage
// ////////////////////////////////////////////////////////////////

// /*
// const routingService = new RoutingService(ledgerService);

// await routingService.routeCase({
//   tenantId: "uuid",
//   caseId: "uuid",
//   intentCode: "ROUTE_SDG_4",
// });
// */

// ////////////////////////////////////////////////////////////////
// // Design reasoning
// ////////////////////////////////////////////////////////////////
// Routing is a deterministic selection process, not a lifecycle mutation.
// This service enforces tenant scoping, schema-bound enums, snapshot
// persistence, and sovereign ledger recording without mutating lifecycle.

// ////////////////////////////////////////////////////////////////
// // Structure
// ////////////////////////////////////////////////////////////////
// 1. Validate boundary input
// 2. Tenant-scoped case lookup
// 3. Tenant-scoped execution body lookup
// 4. Deterministic matching
// 5. Snapshot persistence (RoutingDecision)
// 6. Authoritative ledger commit
// 7. Return canonical outcome

// ////////////////////////////////////////////////////////////////
// // Implementation guidance
// ////////////////////////////////////////////////////////////////
// Never fetch case without tenantId filter.
// Never reference fallback by literal name.
// Never mutate lifecycle here.
// Lifecycle transitions must be handled upstream via governance service.

// ////////////////////////////////////////////////////////////////
// // Scalability insight
// ////////////////////////////////////////////////////////////////
// Routing is idempotent if repeated with same state.
// Ledger guarantees replay trace.
// Tenant scoping ensures horizontal safety.
// ExecutionBody capability structure can evolve without breaking routing core.
