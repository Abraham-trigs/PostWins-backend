// apps/backend/src/modules/cases/transitionCaseLifecycleWithLedger.ts
// Enforced lifecycle transition with atomic ledger authority and invariant protection.

import { prisma } from "@/lib/prisma";
import { CaseLifecycle, LedgerEventType, ActorKind } from "@prisma/client";
import { transitionCaseLifecycle } from "./transitionCaseLifecycle";
import { commitLedgerEvent } from "../routing/commitRoutingLedger";
import { LifecycleInvariantViolationError } from "./case.errors";
import { CASE_LIFECYCLE_LEDGER_EVENTS } from "./caseLifecycle.events";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation Schema
////////////////////////////////////////////////////////////////

const TransitionWithLedgerSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid(),
    target: z.nativeEnum(CaseLifecycle),
    actor: z.object({
      kind: z.nativeEnum(ActorKind),
      userId: z.string().uuid().optional(),
      authorityProof: z.string().min(1),
    }),
    intentContext: z.unknown().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.actor.kind === ActorKind.HUMAN && !data.actor.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actor", "userId"],
        message: "userId required for HUMAN actor",
      });
    }
    if (data.actor.kind === ActorKind.SYSTEM && data.actor.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actor", "userId"],
        message: "SYSTEM actor must not include userId",
      });
    }
  });

export type TransitionWithLedgerParams = z.infer<
  typeof TransitionWithLedgerSchema
>;

////////////////////////////////////////////////////////////////
// Transition + Ledger Authority
////////////////////////////////////////////////////////////////

export async function transitionCaseLifecycleWithLedger(
  input: unknown,
): Promise<CaseLifecycle> {
  const parsed = TransitionWithLedgerSchema.safeParse(input);

  if (!parsed.success) {
    throw { error: parsed.error.flatten().fieldErrors };
  }

  const params = parsed.data;

  return prisma.$transaction(async (tx) => {
    // 1️⃣ Load authoritative lifecycle
    const c = await tx.case.findUniqueOrThrow({
      where: { id: params.caseId },
      select: { lifecycle: true },
    });

    const previousLifecycle = c.lifecycle;

    // 2️⃣ Pure deterministic transition
    const next = transitionCaseLifecycle({
      caseId: params.caseId,
      current: previousLifecycle,
      target: params.target,
    });

    // 3️⃣ EXECUTING invariant
    if (next === CaseLifecycle.EXECUTING) {
      const execution = await tx.execution.findUnique({
        where: { caseId: params.caseId },
        select: { id: true },
      });

      if (!execution) {
        throw new LifecycleInvariantViolationError(
          "EXECUTING_REQUIRES_EXECUTION_EXISTENCE",
        );
      }
    }

    // 4️⃣ Resolve strict ledger event mapping
    const ledgerEvent: LedgerEventType | undefined =
      CASE_LIFECYCLE_LEDGER_EVENTS[next];

    if (!ledgerEvent) {
      throw new LifecycleInvariantViolationError(
        "MISSING_LEDGER_EVENT_MAPPING_FOR_LIFECYCLE",
      );
    }

    // 5️⃣ Global monotonic timestamp via sequence
    const [{ nextval }] = await tx.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('ledger_global_seq')`;

    const nowTs = nextval;

    // 6️⃣ Optimistic concurrency projection update
    const updated = await tx.case.updateMany({
      where: {
        id: params.caseId,
        lifecycle: previousLifecycle,
      },
      data: {
        lifecycle: next,
      },
    });

    if (updated.count !== 1) {
      throw new LifecycleInvariantViolationError(
        "LIFECYCLE_CONCURRENT_MODIFICATION_DETECTED",
      );
    }

    // 7️⃣ Authoritative ledger commit
    await commitLedgerEvent(tx, {
      tenantId: params.tenantId,
      caseId: params.caseId,
      eventType: ledgerEvent,
      actor: params.actor,
      intentContext: params.intentContext,
      payload: {
        from: previousLifecycle,
        to: next,
        projectionVersion: nowTs.toString(),
      },
      overrideTimestamp: nowTs,
    });

    return next;
  });
}

// ////////////////////////////////////////////////////////////////
// // Example Usage
// ////////////////////////////////////////////////////////////////

// /*
// await transitionCaseLifecycleWithLedger({
//   tenantId: "uuid",
//   caseId: "uuid",
//   target: CaseLifecycle.ROUTED,
//   actor: {
//     kind: ActorKind.SYSTEM,
//     authorityProof: "routing-engine-v1",
//   },
// });
// */

// ////////////////////////////////////////////////////////////////
// // Design reasoning
// ////////////////////////////////////////////////////////////////
// Lifecycle transitions are authoritative only if ledger commits are atomic
// and causally bound. This implementation enforces schema-derived lifecycle,
// strict event mapping, optimistic concurrency, and sequence-backed ordering.

// ////////////////////////////////////////////////////////////////
// // Structure
// ////////////////////////////////////////////////////////////////
// 1. Validate input boundary
// 2. Load authoritative lifecycle
// 3. Apply pure transition law
// 4. Enforce execution invariant
// 5. Allocate monotonic sequence timestamp
// 6. Optimistic projection update
// 7. Ledger commit within same transaction

// ////////////////////////////////////////////////////////////////
// // Implementation guidance
// ////////////////////////////////////////////////////////////////
// Never write Case.lifecycle directly anywhere else.
// Never fallback to generic ledger events.
// Ensure ledger_global_seq exists in database.

// ////////////////////////////////////////////////////////////////
// // Scalability insight
// ////////////////////////////////////////////////////////////////
// Sequence-backed ordering guarantees deterministic replay across
// distributed instances. Optimistic concurrency protects against race
// conditions without locking entire tables.
