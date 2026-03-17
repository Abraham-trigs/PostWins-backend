// File: apps/backend/src/modules/intake/services/intake.bootstrap.service.ts
// Purpose: Atomic bootstrap logic for Case creation, Beneficiary resolution, Ledgering, and UI Projection.

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

////////////////////////////////////////////////////////////////
// Init
////////////////////////////////////////////////////////////////

const integrityService = new IntegrityService();
const intakeService = new IntakeService(integrityService, new TaskService());

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

type CreateBeneficiaryInput = {
  displayName?: string;
  phone?: string;
};

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

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

    ////////////////////////////////////////////////////////////////
    // 1. Trust Context
    ////////////////////////////////////////////////////////////////

    const authorUserId = await resolveAuthorUserId(req, tenantId, prisma);
    const trust = buildTrustContext(req, tenantId, authorUserId);

    ////////////////////////////////////////////////////////////////
    // 2. Integrity Gate
    ////////////////////////////////////////////////////////////////

    const integrityFlags: IntegrityFlag[] = await enforceIntegrityGate(
      integrityService,
      narrative,
      trust,
    );

    ////////////////////////////////////////////////////////////////
    // 3. Intake Processing
    ////////////////////////////////////////////////////////////////

    const intakeResult = await intakeService.handleIntake(narrative, trust);
    const referenceCode = generateReferenceCode();

    ////////////////////////////////////////////////////////////////
    // 4. Transaction (ATOMIC)
    ////////////////////////////////////////////////////////////////

    const responsePayload = await prisma.$transaction(async (tx) => {
      let finalBeneficiaryId: string | null = null;
      let newBeneficiaryCreated = false;

      ////////////////////////////////////////////////////////////////
      // BENEFICIARY RESOLUTION (SELECT OR CREATE)
      ////////////////////////////////////////////////////////////////

      if (beneficiaryId) {
        const isJson =
          typeof beneficiaryId === "string" &&
          beneficiaryId.trim().startsWith("{");

        /**
         * CASE 1: CREATE NEW BENEFICIARY
         */
        if (isJson) {
          let data: CreateBeneficiaryInput;

          try {
            data = JSON.parse(beneficiaryId);
          } catch {
            throw new Error("Invalid beneficiary payload");
          }

          // Normalize inputs
          const phone = data.phone?.trim() || null;
          const displayName = data.displayName?.trim() || null;

          /**
           * Prevent duplicate phone within tenant
           */
          if (phone) {
            const existing = await tx.beneficiaryPII.findFirst({
              where: {
                phone,
                beneficiary: { tenantId: trust.tenantId },
              },
              select: { beneficiaryId: true },
            });

            if (existing) {
              // Instead of throwing → SELECT existing (better UX)
              finalBeneficiaryId = existing.beneficiaryId;
            }
          }

          /**
           * Create only if not resolved
           */
          if (!finalBeneficiaryId) {
            const newBeni = await tx.beneficiary.create({
              data: {
                tenantId: trust.tenantId,
                displayName,
                pii: phone ? { create: { phone } } : undefined,
                profile: {
                  create: {
                    consentToDataStorage: true,
                  },
                },
              },
              select: { id: true },
            });

            finalBeneficiaryId = newBeni.id;
            newBeneficiaryCreated = true;
          }
        } else {
          /**
           * CASE 2: EXISTING BENEFICIARY SELECTED
           */
          const exists = await tx.beneficiary.findFirst({
            where: {
              id: beneficiaryId,
              tenantId: trust.tenantId,
            },
            select: { id: true },
          });

          if (!exists) {
            throw new Error("Beneficiary not found");
          }

          finalBeneficiaryId = exists.id;
        }
      }

      ////////////////////////////////////////////////////////////////
      // SYSTEM ACTOR
      ////////////////////////////////////////////////////////////////

      const systemActor = await tx.user.findFirst({
        where: {
          tenantId: trust.tenantId,
          roles: { some: { role: { key: "SYSTEM" } } },
        },
        select: { id: true },
      });

      const systemActorUserId =
        systemActor?.id ?? trust.actorUserId ?? authorUserId ?? null;

      ////////////////////////////////////////////////////////////////
      // TASK DEFINITIONS
      ////////////////////////////////////////////////////////////////

      const taskDefs = await tx.taskDefinition.findMany({
        where: { tenantId: trust.tenantId, isActive: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });

      ////////////////////////////////////////////////////////////////
      // EXECUTION BODY CONTEXT
      ////////////////////////////////////////////////////////////////

      const membership = await tx.executionBodyMember.findFirst({
        where: { tenantId: trust.tenantId, userId: trust.actorUserId },
        select: { executionBodyId: true },
      });

      const originExecutionBodyId = membership?.executionBodyId ?? null;

      ////////////////////////////////////////////////////////////////
      // CREATE CASE
      ////////////////////////////////////////////////////////////////

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

      ////////////////////////////////////////////////////////////////
      // TASK SCAFFOLDING
      ////////////////////////////////////////////////////////////////

      if (taskDefs.length > 0) {
        await tx.caseTask.createMany({
          data: taskDefs.map((td) => ({
            tenantId: trust.tenantId,
            caseId: createdCase.id,
            taskDefinitionId: td.id,
          })),
        });
      }

      ////////////////////////////////////////////////////////////////
      // VERIFICATION
      ////////////////////////////////////////////////////////////////

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

      ////////////////////////////////////////////////////////////////
      // LEDGER EVENT
      ////////////////////////////////////////////////////////////////

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
            idempotencyKey,
            requestHash: requestHash ?? "no-hash",
          },
          payload: {
            caseId: createdCase.id,
            referenceCode,
            narrative: intakeResult.description,
            beneficiaryId: finalBeneficiaryId ?? undefined,
            newBeneficiaryCreated,
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

      ////////////////////////////////////////////////////////////////
      // UI PROJECTION
      ////////////////////////////////////////////////////////////////

      await tx.message.create({
        data: {
          tenantId: trust.tenantId,
          caseId: createdCase.id,
          authorId: systemActorUserId ?? trust.actorUserId!,
          type: MessageType.SYSTEM_EVENT,
          body: `Case ${referenceCode} initialized.`,
        },
      });

      ////////////////////////////////////////////////////////////////
      // RESPONSE
      ////////////////////////////////////////////////////////////////

      return {
        ok: true,
        caseId: createdCase.id,
        referenceCode,
        beneficiaryId: finalBeneficiaryId,
        newBeneficiaryCreated,
      };
    });

    return responsePayload;
  }
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Keeps beneficiary logic inside bootstrap to preserve atomicity.
// Prevents duplicate PII by resolving existing before creation.
// Avoids throwing on duplicate phone → improves UX by auto-selecting existing.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// bootstrap()
// ├── trust context
// ├── integrity
// ├── beneficiary resolve/create
// ├── case creation
// ├── ledger commit
// └── response

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Frontend flow:
// 1. GET /intake/beneficiaries (search/select)
// 2. OR send JSON string as beneficiaryId
// 3. POST /intake/bootstrap

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// This pattern supports future:
// - deduplication via nationalId
// - fuzzy matching
// - external identity verification
// - beneficiary audit ledger (separate event)
