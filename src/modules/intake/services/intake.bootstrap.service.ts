// File: apps/backend/src/modules/intake/services/intake.bootstrap.service.ts
// Purpose: Atomic bootstrap logic for Case creation, Ledgering, and UI Projection.

import { Request } from "express";
import {
  ActorKind,
  CaseLifecycle,
  CaseStatus,
  LedgerEventType,
  MessageType,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";

import { IntakeService } from "./intake.service";
import { IntegrityService } from "../intergrity/integrity.service";

import { TaskService } from "@/modules/routing/structuring/task.service";

import {
  requireTenantId,
  resolveAuthorUserId,
  generateReferenceCode,
} from "../helpers/intake.helpers";

import { buildTrustContext } from "@/modules/auth/trust/buildTrustContext";
import { enforceIntegrityGate } from "@/modules/policies/integrity-gate.policy";
import { IntegrityFlag } from "@posta/core";

const integrityService = new IntegrityService();

/**
 * FIX: IntakeService no longer requires IntegrityService in constructor
 */
const intakeService = new IntakeService(integrityService, new TaskService());

export class IntakeBootstrapService {
  async bootstrap(
    req: Request,
    body: any,
    idempotencyKey: string,
    requestHash: string | undefined,
  ) {
    const tenantId = requireTenantId(req);

    const { narrative, beneficiaryId, category, location, language, sdgGoals } =
      body;

    /* -------------------------------------------------------------------
    1. Build Unified Trust Context
    ------------------------------------------------------------------- */
    const authorUserId = await resolveAuthorUserId(req, tenantId, prisma);
    const trust = buildTrustContext(req, tenantId, authorUserId);

    /* -------------------------------------------------------------------
    2. Run Integrity Policy
    ------------------------------------------------------------------- */
    const integrityFlags: IntegrityFlag[] = await enforceIntegrityGate(
      integrityService,
      narrative,
      trust,
    );

    /* -------------------------------------------------------------------
    3. Intake Processing
    ------------------------------------------------------------------- */
    const intakeResult = await intakeService.handleIntake(narrative, trust);
    const referenceCode = generateReferenceCode();

    /* -------------------------------------------------------------------
    4. Transaction
    ------------------------------------------------------------------- */
    const responsePayload = await prisma.$transaction(async (tx) => {
      let finalBeneficiaryId: string | null = null;

      // Resolve or Create Beneficiary
      if (beneficiaryId) {
        const isJson = beneficiaryId.trim().startsWith("{");

        if (isJson) {
          const data = JSON.parse(beneficiaryId);

          if (data.phone) {
            const existing = await tx.beneficiaryPII.count({
              where: {
                phone: data.phone,
                beneficiary: { tenantId: trust.tenantId },
              },
            });

            if (existing > 0) {
              throw new Error(`Phone ${data.phone} already exists.`);
            }
          }

          const newBeni = await tx.beneficiary.create({
            data: {
              tenantId: trust.tenantId,
              displayName: data.displayName,
              pii: { create: { phone: data.phone } },
              profile: { create: { consentToDataStorage: true } },
            },
            select: { id: true },
          });

          finalBeneficiaryId = newBeni.id;
        } else {
          finalBeneficiaryId = beneficiaryId;
        }
      }

      // Resolve System Actor for Projection
      const systemActor = await tx.user.findFirst({
        where: {
          tenantId: trust.tenantId,
          roles: { some: { role: { key: "SYSTEM" } } },
        },
        select: { id: true },
      });

      /**
       * FIX: avoid empty string fallback
       */
      const systemActorUserId =
        systemActor?.id ?? trust.actorUserId ?? authorUserId ?? null;

      const taskDefs = await tx.taskDefinition.findMany({
        where: { tenantId: trust.tenantId, isActive: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });

      const membership = await tx.executionBodyMember.findFirst({
        where: { tenantId: trust.tenantId, userId: trust.actorUserId },
        select: { executionBodyId: true },
      });

      const originExecutionBodyId = membership?.executionBodyId ?? null;

      // Create Case Record
      const createdCase = await tx.case.create({
        data: {
          tenantId: trust.tenantId,
          authorUserId: trust.actorUserId ?? authorUserId,
          beneficiaryId: finalBeneficiaryId,
          originExecutionBodyId,
          referenceCode,
          mode: intakeResult.mode,
          scope: intakeResult.scope,
          type: intakeResult.intent,
          lifecycle: CaseLifecycle.INTAKE,
          status: CaseStatus.INTAKED,
          summary: intakeResult.description.slice(0, 240),
          currentTaskDefinitionId: taskDefs[0]?.id ?? null,
        },
        select: { id: true },
      });

      // Scaffold Case Tasks
      if (taskDefs.length > 0) {
        await tx.caseTask.createMany({
          data: taskDefs.map((td) => ({
            tenantId: trust.tenantId,
            caseId: createdCase.id,
            taskDefinitionId: td.id,
          })),
        });
      }

      // Scaffold Verification
      const verificationRecord = await tx.verificationRecord.create({
        data: {
          tenantId: trust.tenantId,
          caseId: createdCase.id,
          requiredVerifiers: 2,
          consensusReached: false,
          routedAt: new Date(),
        },
        select: { id: true },
      });

      // Commit Authoritative Ledger Event
      await commitLedgerEvent(
        {
          tenantId: trust.tenantId,
          caseId: createdCase.id,
          eventType: LedgerEventType.CASE_CREATED,
          actor: {
            kind: ActorKind.HUMAN,
            userId: trust.actorUserId ?? undefined,
            authorityProof: `HUMAN:${trust.actorUserId || "guest"}:${idempotencyKey}:${requestHash ?? "no-hash"}`,
          },
          intentContext: {
            idempotencyKey: idempotencyKey,
            requestHash: requestHash ?? "no-hash",
          },
          payload: {
            caseId: createdCase.id,
            referenceCode,
            narrative: intakeResult.description,
            beneficiaryId: finalBeneficiaryId ?? undefined,
            category: category ?? null,
            location: location ?? null,
            language: language ?? null,
            sdgGoals: Array.isArray(sdgGoals) ? sdgGoals : [],
            verificationRecordId: verificationRecord.id,
            mode: intakeResult.mode,
            scope: intakeResult.scope,
            intent: intakeResult.intent,
            integrityFlags,
          },
        },
        tx,
      );

      // Insert UI Projection Message
      await tx.message.create({
        data: {
          tenantId: trust.tenantId,
          caseId: createdCase.id,
          authorId: systemActorUserId ?? trust.actorUserId!,
          type: MessageType.SYSTEM_EVENT,
          body: `Case ${referenceCode} initialized.`,
        },
      });

      return { ok: true, caseId: createdCase.id, referenceCode };
    });

    return responsePayload;
  }
}
