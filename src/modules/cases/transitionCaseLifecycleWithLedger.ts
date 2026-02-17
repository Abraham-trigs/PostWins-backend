// apps/backend/src/modules/cases/transitionCaseLifecycleWithLedger.ts
// Deterministic lifecycle transition with atomic ledger authority + structured governance logging.

import { prisma } from "@/lib/prisma";
import { CaseLifecycle, ActorKind } from "@prisma/client";
import { transitionCaseLifecycle } from "./transitionCaseLifecycle";
import { LifecycleInvariantViolationError } from "./case.errors";
import { CASE_LIFECYCLE_LEDGER_EVENTS } from "./caseLifecycle.events";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import { log } from "@/lib/observability/logger";
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
// Overloads (Backward Compatibility Layer)
////////////////////////////////////////////////////////////////

export async function transitionCaseLifecycleWithLedger(
  input: unknown,
): Promise<CaseLifecycle>;

export async function transitionCaseLifecycleWithLedger(
  ledger: LedgerService,
  input: unknown,
): Promise<CaseLifecycle>;

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

export async function transitionCaseLifecycleWithLedger(
  arg1: LedgerService | unknown,
  arg2?: unknown,
): Promise<CaseLifecycle> {
  const ledger = arg1 instanceof LedgerService ? arg1 : new LedgerService();

  const input = arg1 instanceof LedgerService ? arg2 : arg1;

  const parsed = TransitionWithLedgerSchema.safeParse(input);

  if (!parsed.success) {
    throw new LifecycleTransitionValidationError(
      parsed.error.flatten().fieldErrors,
    );
  }

  const params = parsed.data;

  let previousLifecycle: CaseLifecycle | null = null;
  let next: CaseLifecycle | null = null;

  await prisma.$transaction(async (tx) => {
    const c = await tx.case.findFirstOrThrow({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
      },
      select: { lifecycle: true },
    });

    previousLifecycle = c.lifecycle;

    next = transitionCaseLifecycle({
      caseId: params.caseId,
      current: previousLifecycle,
      target: params.target,
    });

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

    const ledgerEvent = CASE_LIFECYCLE_LEDGER_EVENTS[next];

    if (!ledgerEvent) {
      throw new LifecycleInvariantViolationError(
        "MISSING_LEDGER_EVENT_MAPPING_FOR_LIFECYCLE",
      );
    }

    const updated = await tx.case.updateMany({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
        lifecycle: previousLifecycle,
      },
      data: { lifecycle: next },
    });

    if (updated.count !== 1) {
      throw new LifecycleInvariantViolationError(
        "LIFECYCLE_CONCURRENT_MODIFICATION_DETECTED",
      );
    }

    await ledger.appendEntry(
      {
        tenantId: params.tenantId,
        caseId: params.caseId,
        eventType: ledgerEvent,
        actorKind: params.actor.kind,
        actorUserId: params.actor.userId ?? null,
        authorityProof: params.actor.authorityProof,
        intentContext: params.intentContext,
        payload: buildAuthorityEnvelopeV1({
          domain: "CASE_LIFECYCLE",
          event: "TRANSITION",
          data: {
            from: previousLifecycle,
            to: next,
          },
        }),
      },
      tx,
    );
  });

  if (previousLifecycle === null || next === null) {
    throw new Error("Lifecycle transition failed unexpectedly");
  }

  log("INFO", "Lifecycle transition committed", {
    tenantId: params.tenantId,
    caseId: params.caseId,
    from: previousLifecycle,
    to: next,
  });

  return next;
}
