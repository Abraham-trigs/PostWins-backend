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
      // 1️⃣ Validate lifecycle
      ////////////////////////////////////////////////////////////

      const existingCase = await tx.case.findFirstOrThrow({
        where: {
          id: data.caseId,
          tenantId: data.tenantId,
        },
        select: { lifecycle: true },
      });

      if (existingCase.lifecycle !== CaseLifecycle.VERIFIED) {
        throw new Error("APPEAL_CAN_ONLY_BE_OPENED_FROM_VERIFIED_STATE");
      }

      ////////////////////////////////////////////////////////////
      // 2️⃣ Create appeal
      ////////////////////////////////////////////////////////////

      const appeal = await tx.appeal.create({
        data: {
          tenantId: data.tenantId,
          caseId: data.caseId,
          openedByUserId: data.openedByUserId,
          reason: data.reason,
          status: "OPEN",
        },
      });

      ////////////////////////////////////////////////////////////
      // 3️⃣ Ledger: APPEAL_OPENED
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
      // 4️⃣ Lifecycle transition → HUMAN_REVIEW
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
      // 1️⃣ Validate lifecycle
      ////////////////////////////////////////////////////////////

      const existingCase = await tx.case.findFirstOrThrow({
        where: {
          id: data.caseId,
          tenantId: data.tenantId,
        },
        select: { lifecycle: true },
      });

      if (existingCase.lifecycle !== CaseLifecycle.HUMAN_REVIEW) {
        throw new Error("APPEAL_CAN_ONLY_BE_RESOLVED_FROM_HUMAN_REVIEW_STATE");
      }

      ////////////////////////////////////////////////////////////
      // 2️⃣ Validate appeal
      ////////////////////////////////////////////////////////////

      const appeal = await tx.appeal.findFirstOrThrow({
        where: {
          id: data.appealId,
          tenantId: data.tenantId,
          caseId: data.caseId,
          status: "OPEN",
        },
      });

      ////////////////////////////////////////////////////////////
      // 3️⃣ Server-determined supersession
      ////////////////////////////////////////////////////////////

      const latestVerifiedCommit = await tx.ledgerCommit.findFirst({
        where: {
          tenantId: data.tenantId,
          caseId: data.caseId,
          eventType: LedgerEventType.VERIFIED,
          supersededBy: null,
        },
        orderBy: { ts: "desc" },
        select: { id: true },
      });

      ////////////////////////////////////////////////////////////
      // 4️⃣ Mark appeal resolved
      ////////////////////////////////////////////////////////////

      await tx.appeal.update({
        where: { id: appeal.id },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
        },
      });

      ////////////////////////////////////////////////////////////
      // 5️⃣ Ledger: APPEAL_RESOLVED
      ////////////////////////////////////////////////////////////

      await this.ledger.appendEntry(
        {
          tenantId: data.tenantId,
          caseId: data.caseId,
          eventType: LedgerEventType.APPEAL_RESOLVED,
          actorKind: ActorKind.HUMAN,
          actorUserId: data.resolvedByUserId,
          authorityProof: data.authorityProof,
          supersedesCommitId: latestVerifiedCommit?.id ?? null,
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
      // 6️⃣ Lifecycle transition → VERIFIED | FLAGGED
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
