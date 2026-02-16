// apps/backend/src/modules/cases/transitionCaseLifecycleWithLedger.ts

import { prisma } from "@/lib/prisma";
import {
  CaseLifecycle,
  LedgerEventType,
  ActorKind,
  Prisma,
} from "@prisma/client";
import { transitionCaseLifecycle } from "./transitionCaseLifecycle";
import { LifecycleInvariantViolationError } from "./case.errors";
import { CASE_LIFECYCLE_LEDGER_EVENTS } from "./caseLifecycle.events";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Errors
////////////////////////////////////////////////////////////////

export class LifecycleTransitionValidationError extends Error {
  public readonly details: Record<string, string[] | undefined>;
  constructor(details: Record<string, string[] | undefined>) {
    super("Invalid lifecycle transition request");
    this.name = "LifecycleTransitionValidationError";
    this.details = details;
  }
}

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

////////////////////////////////////////////////////////////////
// Transition + Ledger Authority
////////////////////////////////////////////////////////////////

export async function transitionCaseLifecycleWithLedger(
  ledger: LedgerService,
  input: unknown,
): Promise<CaseLifecycle> {
  const parsed = TransitionWithLedgerSchema.safeParse(input);

  if (!parsed.success) {
    throw new LifecycleTransitionValidationError(
      parsed.error.flatten().fieldErrors,
    );
  }

  const params = parsed.data;

  return prisma.$transaction(async (tx) => {
    ////////////////////////////////////////////////////////////////
    // 1️⃣ Load authoritative lifecycle (tenant scoped)
    ////////////////////////////////////////////////////////////////

    const c = await tx.case.findFirstOrThrow({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
      },
      select: { lifecycle: true },
    });

    const previousLifecycle = c.lifecycle;

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Deterministic transition
    ////////////////////////////////////////////////////////////////

    const next = transitionCaseLifecycle({
      caseId: params.caseId,
      current: previousLifecycle,
      target: params.target,
    });

    ////////////////////////////////////////////////////////////////
    // 3️⃣ EXECUTING invariant
    ////////////////////////////////////////////////////////////////

    if (next === CaseLifecycle.EXECUTING) {
      const execution = await tx.execution.findFirst({
        where: {
          caseId: params.caseId,
          tenantId: params.tenantId,
        },
        select: { id: true },
      });

      if (!execution) {
        throw new LifecycleInvariantViolationError(
          "EXECUTING_REQUIRES_EXECUTION_EXISTENCE",
        );
      }
    }

    ////////////////////////////////////////////////////////////////
    // 4️⃣ Strict lifecycle → ledger mapping
    ////////////////////////////////////////////////////////////////

    const ledgerEvent = CASE_LIFECYCLE_LEDGER_EVENTS[next];

    if (!ledgerEvent) {
      throw new LifecycleInvariantViolationError(
        "MISSING_LEDGER_EVENT_MAPPING_FOR_LIFECYCLE",
      );
    }

    ////////////////////////////////////////////////////////////////
    // 5️⃣ Optimistic concurrency update
    ////////////////////////////////////////////////////////////////

    const updated = await tx.case.updateMany({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
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

    ////////////////////////////////////////////////////////////////
    // 6️⃣ Atomic ledger commit (MUST use tx)
    ////////////////////////////////////////////////////////////////

    await ledger.commit(
      {
        tenantId: params.tenantId,
        caseId: params.caseId,
        eventType: ledgerEvent,
        actorKind: params.actor.kind,
        actorUserId: params.actor.userId ?? null,
        authorityProof: params.actor.authorityProof,
        intentContext: params.intentContext,
        payload: {
          from: previousLifecycle,
          to: next,
        },
      },
      tx, // 🔒 TRUE ATOMICITY
    );

    return next;
  });
}
