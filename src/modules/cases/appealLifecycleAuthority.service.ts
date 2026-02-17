// apps/backend/src/modules/cases/appealLifecycleAuthority.service.ts
// Appeal governance authority pipeline with lifecycle transitions + supersession binding.
// Assumes:
// - transitionCaseLifecycleWithLedger enforces lifecycle law
// - LedgerService hashes payload deterministically
// - AuthorityEnvelope V1 is active
// - LedgerEventType includes APPEAL_OPENED and APPEAL_RESOLVED

import { prisma } from "@/lib/prisma";
import { CaseLifecycle, LedgerEventType, ActorKind } from "@prisma/client";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { transitionCaseLifecycleWithLedger } from "./transitionCaseLifecycleWithLedger";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Errors
////////////////////////////////////////////////////////////////

export class AppealAuthorityValidationError extends Error {
  public readonly details: Record<string, string[] | undefined>;
  constructor(details: Record<string, string[] | undefined>) {
    super("Invalid appeal authority request");
    this.name = "AppealAuthorityValidationError";
    this.details = details;
  }
}

////////////////////////////////////////////////////////////////
// Schemas
////////////////////////////////////////////////////////////////

const OpenAppealSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  openedByUserId: z.string().uuid(),
  reason: z.string().min(1),
  authorityProof: z.string().min(1),
});

const ResolveAppealSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  appealId: z.string().uuid(),
  resolution: z.enum(["VERIFIED", "FLAGGED"]),
  resolvedByUserId: z.string().uuid(),
  authorityProof: z.string().min(1),
  supersedesCommitId: z.string().uuid(),
});

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class AppealLifecycleAuthorityService {
  constructor(private ledger: LedgerService) {}

  ////////////////////////////////////////////////////////////////
  // Open Appeal
  ////////////////////////////////////////////////////////////////

  async openAppeal(input: unknown) {
    const parsed = OpenAppealSchema.safeParse(input);

    if (!parsed.success) {
      throw new AppealAuthorityValidationError(
        parsed.error.flatten().fieldErrors,
      );
    }

    const data = parsed.data;

    return prisma.$transaction(async (tx) => {
      ////////////////////////////////////////////////////////////
      // 1️⃣ Create appeal record
      ////////////////////////////////////////////////////////////

      const appeal = await tx.appeal.create({
        data: {
          tenantId: data.tenantId,
          caseId: data.caseId,
          openedByUserId: data.openedByUserId,
          reason: data.reason,
        },
      });

      ////////////////////////////////////////////////////////////
      // 2️⃣ Commit APPEAL_OPENED to ledger
      ////////////////////////////////////////////////////////////

      await this.ledger.appendEntry(
        {
          tenantId: data.tenantId,
          caseId: data.caseId,
          eventType: LedgerEventType.APPEAL_OPENED,
          actorKind: ActorKind.HUMAN,
          actorUserId: data.openedByUserId,
          authorityProof: data.authorityProof,
          payload: buildAuthorityEnvelopeV1({
            domain: "APPEAL",
            event: "OPENED",
            data: {
              appealId: appeal.id,
              reason: data.reason,
            },
          }),
        },
        tx,
      );

      ////////////////////////////////////////////////////////////
      // 3️⃣ Lifecycle transition VERIFIED → HUMAN_REVIEW
      ////////////////////////////////////////////////////////////

      await transitionCaseLifecycleWithLedger(this.ledger, {
        tenantId: data.tenantId,
        caseId: data.caseId,
        target: CaseLifecycle.HUMAN_REVIEW,
        actor: {
          kind: ActorKind.HUMAN,
          userId: data.openedByUserId,
          authorityProof: data.authorityProof,
        },
      });

      return appeal;
    });
  }

  ////////////////////////////////////////////////////////////////
  // Resolve Appeal
  ////////////////////////////////////////////////////////////////

  async resolveAppeal(input: unknown) {
    const parsed = ResolveAppealSchema.safeParse(input);

    if (!parsed.success) {
      throw new AppealAuthorityValidationError(
        parsed.error.flatten().fieldErrors,
      );
    }

    const data = parsed.data;

    return prisma.$transaction(async (tx) => {
      ////////////////////////////////////////////////////////////
      // 1️⃣ Mark appeal resolved
      ////////////////////////////////////////////////////////////

      const appeal = await tx.appeal.update({
        where: { id: data.appealId },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
        },
      });

      ////////////////////////////////////////////////////////////
      // 2️⃣ Commit APPEAL_RESOLVED (superseding prior decision)
      ////////////////////////////////////////////////////////////

      await this.ledger.appendEntry(
        {
          tenantId: data.tenantId,
          caseId: data.caseId,
          eventType: LedgerEventType.APPEAL_RESOLVED,
          actorKind: ActorKind.HUMAN,
          actorUserId: data.resolvedByUserId,
          authorityProof: data.authorityProof,
          supersedesCommitId: data.supersedesCommitId,
          payload: buildAuthorityEnvelopeV1({
            domain: "APPEAL",
            event: "RESOLVED",
            data: {
              appealId: appeal.id,
              resolution: data.resolution,
            },
          }),
        },
        tx,
      );

      ////////////////////////////////////////////////////////////
      // 3️⃣ Lifecycle transition HUMAN_REVIEW → VERIFIED | FLAGGED
      ////////////////////////////////////////////////////////////

      const targetLifecycle =
        data.resolution === "VERIFIED"
          ? CaseLifecycle.VERIFIED
          : CaseLifecycle.FLAGGED;

      await transitionCaseLifecycleWithLedger(this.ledger, {
        tenantId: data.tenantId,
        caseId: data.caseId,
        target: targetLifecycle,
        actor: {
          kind: ActorKind.HUMAN,
          userId: data.resolvedByUserId,
          authorityProof: data.authorityProof,
        },
      });

      return appeal;
    });
  }
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Appeals introduce reversible authority without mutating lifecycle directly.
// All lifecycle changes flow through constitutional transition boundary.
// Supersession binds resolution to prior authority commit.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod validation
// - Transaction boundary
// - Appeal record mutation
// - Ledger commit (enveloped)
// - Lifecycle transition via authority service

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Supersession validation is not enforced here yet.
// Next step: enforce supersedesCommitId integrity inside LedgerService.
// Map AppealAuthorityValidationError to HTTP 400.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Supersession chains create permanent authority lineage.
// Enables reconstruction of governance history across reversals.
// Foundation for executive override and hierarchy enforcement.
////////////////////////////////////////////////////////////////
