// filepath: apps/backend/src/modules/cases/transitionCaseLifecycleWithLedger.ts
// Purpose: Deterministic lifecycle transition with atomic ledger authority and safe transactional execution.

////////////////////////////////////////////////////////////////
// Assumptions
////////////////////////////////////////////////////////////////
/*
- Prisma schema includes Case.lifecycle enum (CaseLifecycle)
- LedgerService.appendEntry persists authoritative ledger events
- transitionCaseLifecycle() enforces lifecycle transition rules
- CASE_LIFECYCLE_LEDGER_EVENTS maps lifecycle → ledger event
- Lifecycle writes must be atomic with ledger authority
*/

////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////

import { prismaUnsafe as prisma } from "@/lib/prisma";
import { CaseLifecycle, ActorKind, Prisma } from "@prisma/client";
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

    intentContext: z.record(z.unknown()).optional(),
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
// Overloads
////////////////////////////////////////////////////////////////

export async function transitionCaseLifecycleWithLedger(
  input: unknown,
): Promise<CaseLifecycle>;

export async function transitionCaseLifecycleWithLedger(
  input: unknown,
  tx: Prisma.TransactionClient,
): Promise<CaseLifecycle>;

export async function transitionCaseLifecycleWithLedger(
  ledger: LedgerService,
  input: unknown,
): Promise<CaseLifecycle>;

export async function transitionCaseLifecycleWithLedger(
  ledger: LedgerService,
  input: unknown,
  tx: Prisma.TransactionClient,
): Promise<CaseLifecycle>;

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

export async function transitionCaseLifecycleWithLedger(
  arg1: LedgerService | unknown,
  arg2?: unknown,
  arg3?: Prisma.TransactionClient,
): Promise<CaseLifecycle> {
  const hasLedger = arg1 instanceof LedgerService;

  const ledger = hasLedger ? arg1 : new LedgerService();
  const input = hasLedger ? arg2 : arg1;

  const externalTx: Prisma.TransactionClient | undefined = hasLedger
    ? (arg3 as Prisma.TransactionClient | undefined)
    : (arg2 as Prisma.TransactionClient | undefined);

  const parsed = TransitionWithLedgerSchema.safeParse(input);

  if (!parsed.success) {
    throw new LifecycleTransitionValidationError(
      parsed.error.flatten().fieldErrors,
    );
  }

  const params = parsed.data;

  let previousLifecycle: CaseLifecycle | null = null;
  let next: CaseLifecycle | null = null;

  ////////////////////////////////////////////////////////////////
  // Core transactional execution
  ////////////////////////////////////////////////////////////////

  const execute = async (tx: Prisma.TransactionClient) => {
    ////////////////////////////////////////////////////////////////
    // Load authoritative lifecycle
    ////////////////////////////////////////////////////////////////

    const c = await tx.case.findFirstOrThrow({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
      },
      select: { lifecycle: true },
    });

    previousLifecycle = c.lifecycle;

    ////////////////////////////////////////////////////////////////
    // Deterministic transition
    ////////////////////////////////////////////////////////////////

    next = transitionCaseLifecycle({
      caseId: params.caseId,
      current: previousLifecycle,
      target: params.target,
    });

    ////////////////////////////////////////////////////////////////
    // EXECUTING invariant
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
    // Ledger mapping validation
    ////////////////////////////////////////////////////////////////

    const ledgerEvent = CASE_LIFECYCLE_LEDGER_EVENTS[next];

    if (!ledgerEvent) {
      throw new LifecycleInvariantViolationError(
        "MISSING_LEDGER_EVENT_MAPPING_FOR_LIFECYCLE",
      );
    }

    ////////////////////////////////////////////////////////////////
    // Optimistic concurrency lifecycle update
    ////////////////////////////////////////////////////////////////

    const lifecycleUpdate: Prisma.CaseUpdateManyMutationInput = {
      lifecycle: next,
    };

    const updated = await tx.case.updateMany({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
        lifecycle: previousLifecycle,
      },
      data: lifecycleUpdate,
    });

    if (updated.count !== 1) {
      throw new LifecycleInvariantViolationError(
        "LIFECYCLE_CONCURRENT_MODIFICATION_DETECTED",
      );
    }

    ////////////////////////////////////////////////////////////////
    // Ledger commit
    ////////////////////////////////////////////////////////////////

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
  };

  ////////////////////////////////////////////////////////////////
  // Execute transaction
  ////////////////////////////////////////////////////////////////

  if (externalTx) {
    await execute(externalTx);
  } else {
    await prisma.$transaction(execute);
  }

  ////////////////////////////////////////////////////////////////
  // Defensive assertion
  ////////////////////////////////////////////////////////////////

  if (previousLifecycle === null || next === null) {
    throw new Error("Lifecycle transition failed unexpectedly");
  }

  ////////////////////////////////////////////////////////////////
  // Structured logging
  ////////////////////////////////////////////////////////////////

  log("INFO", "Lifecycle transition committed", {
    tenantId: params.tenantId,
    caseId: params.caseId,
    from: previousLifecycle,
    to: next,
  });

  return next;
}

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
Lifecycle transitions remain replayable because every mutation
is paired with a ledger event. This allows deterministic system
reconstruction, governance auditing, and policy simulation.
*/
