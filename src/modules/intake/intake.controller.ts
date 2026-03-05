// apps/backend/src/modules/intake/intake.controller.ts
// Purpose: Atomic intake endpoints aligned strictly to Prisma Case schema (no PostWin coupling).

// commitIdempotencyResponse

import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";

import { IntakeService } from "./intake.service";
import { IntegrityService } from "./intergrity/integrity.service";

import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { commitIdempotencyResponse } from "../../middleware/idempotency.middleware";
import { prisma } from "../../lib/prisma";
import { assertUuid, UUID_RE } from "../../utils/uuid";

import { TaskService } from "../routing/structuring/task.service";
import { RoutingService } from "@/modules/routing/routing.service";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";

import {
  ActorKind,
  CaseLifecycle,
  CaseStatus,
  LedgerEventType,
  Prisma,
  ExecutionStatus,
} from "@prisma/client";

////////////////////////////////////////////////////////////////
// Infrastructure
////////////////////////////////////////////////////////////////

const integrityService = new IntegrityService();
const intakeService = new IntakeService(integrityService, new TaskService());
const routingService = new RoutingService(new LedgerService());

////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////

function requireIdempotencyMeta(res: Response) {
  const meta = (res.locals as any).idempotency;
  if (!meta?.key || !meta?.requestHash) {
    throw new Error("IDEMPOTENCY_METADATA_MISSING");
  }
  return meta as { key: string; requestHash: string };
}

function requireTenantId(req: Request): string {
  const tenantId = req.header("X-Tenant-Id")?.trim() || "";
  assertUuid(tenantId, "tenantId");
  return tenantId;
}

async function resolveAuthorUserId(
  req: Request,
  tenantId: string,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const actorHeader = req.header("X-Actor-Id")?.trim();
  if (actorHeader && UUID_RE.test(actorHeader)) return actorHeader;

  const db = tx ?? prisma;

  const user = await db.user.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!user?.id) {
    throw new Error("NO_ACTIVE_USER_FOR_TENANT");
  }

  return user.id;
}

function generateReferenceCode() {
  return `CASE-${Date.now()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const IntakeBootstrapBodySchema = z.object({
  narrative: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 10, "Minimum 10 characters"),
  beneficiaryId: z
    .string()
    .optional()
    .transform((v) => (v && UUID_RE.test(v) ? v : undefined)),
  category: z.any().optional(),
  location: z.any().optional(),
  language: z.string().optional(),
  sdgGoals: z.array(z.string()).optional(),

  autoRoute: z.boolean().optional(),
});

const IntakeDeliveryBodySchema = z.object({
  projectId: z.string().uuid(),
  deliveryId: z.string().min(1),
  occurredAt: z.union([z.string(), z.date()]),
  location: z.any(),
  items: z.array(z.any()).min(1),
  notes: z.string().optional(),
});

////////////////////////////////////////////////////////////////
// Resolve Location
////////////////////////////////////////////////////////////////

export const handleResolveLocation = async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code ?? "").trim();
    if (!code)
      return res.status(400).json({
        ok: false,
        error: "CODE_REQUIRED",
      });

    const result = await intakeService.resolveGhanaPostAddress(code);

    return res.status(200).json({
      ok: true,
      lat: result.lat,
      lng: result.lng,
      bounds: result.bounds,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_ADDRESS") {
      return res.status(400).json({ ok: false, error: err.message });
    }

    return res.status(502).json({
      ok: false,
      error: "LOCATION_RESOLUTION_FAILED",
    });
  }
};

////////////////////////////////////////////////////////////////
// BOOTSTRAP
////////////////////////////////////////////////////////////////

export const handleIntakeBootstrap = async (req: Request, res: Response) => {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

    const tenantId = requireTenantId(req);
    const deviceId = req.header("X-Device-Id") ?? "unknown";

    const parsed = IntakeBootstrapBodySchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.flatten().fieldErrors,
      });
    }

    const {
      narrative,
      beneficiaryId,
      category,
      location,
      language,
      sdgGoals,
      autoRoute,
    } = parsed.data;

    const intakeResult = await intakeService.handleIntake(narrative, deviceId);

    const referenceCode = generateReferenceCode();

    const responsePayload = await prisma.$transaction(async (tx) => {
      const authorUserId = await resolveAuthorUserId(req, tenantId, tx);

      const taskDefs = await tx.taskDefinition.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });

      ////////////////////////////////////////////////////////////////
      // Resolve origin execution body (organization of author)
      ////////////////////////////////////////////////////////////////

      const membership = await tx.executionBodyMember.findFirst({
        where: {
          tenantId,
          userId: authorUserId,
        },
        select: {
          executionBodyId: true,
        },
      });

      const originExecutionBodyId = membership?.executionBodyId ?? null;

      ////////////////////////////////////////////////////////////////
      // Create case
      ////////////////////////////////////////////////////////////////

      const createdCase = await tx.case.create({
        data: {
          tenantId,
          authorUserId,
          beneficiaryId: beneficiaryId ?? null,

          // Origin NGO for routing preference
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
      // Initialize workflow tasks
      ////////////////////////////////////////////////////////////////

      if (taskDefs.length > 0) {
        await tx.caseTask.createMany({
          data: taskDefs.map((td) => ({
            tenantId,
            caseId: createdCase.id,
            taskDefinitionId: td.id,
          })),
          skipDuplicates: true,
        });
      }

      ////////////////////////////////////////////////////////////////
      // Verification record
      ////////////////////////////////////////////////////////////////

      const verificationRecord = await tx.verificationRecord.create({
        data: {
          tenantId,
          caseId: createdCase.id,
          requiredVerifiers: 2,
          consensusReached: false,
          routedAt: new Date(),
        },
        select: { id: true },
      });

      ////////////////////////////////////////////////////////////////
      // Ledger entry
      ////////////////////////////////////////////////////////////////

      await commitLedgerEvent(
        {
          tenantId,
          caseId: createdCase.id,
          eventType: LedgerEventType.CASE_CREATED,
          actor: {
            kind: ActorKind.HUMAN,
            userId: authorUserId,
            authorityProof: `HUMAN:${authorUserId}:${key}:${requestHash}`,
          },
          intentContext: {
            idempotencyKey: key,
            requestHash,
          },
          payload: {
            caseId: createdCase.id,
            referenceCode,
            narrative: intakeResult.description,
            beneficiaryId: beneficiaryId ?? null,
            category: category ?? null,
            location: location ?? null,
            language: language ?? null,
            sdgGoals:
              Array.isArray(sdgGoals) && sdgGoals.length > 0 ? sdgGoals : null,
            verificationRecordId: verificationRecord.id,
            mode: intakeResult.mode,
            scope: intakeResult.scope,
            intent: intakeResult.intent,
          },
        },
        tx,
      );

      return {
        ok: true,
        projectId: createdCase.id,
        referenceCode,
      };
    });
    await commitIdempotencyResponse(res, responsePayload);

    if (autoRoute) {
      try {
        await routingService.routeCase({
          tenantId,
          caseId: responsePayload.projectId,
          intentCode: intakeResult.intent,
        });
      } catch (err) {
        console.warn("AUTO_ROUTING_FAILED", err);
      }
    }

    return res.status(201).json(responsePayload);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "BOOTSTRAP_INTAKE_FAILED",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

////////////////////////////////////////////////////////////////
// DELIVERY
////////////////////////////////////////////////////////////////

export const handleIntakeDelivery = async (req: Request, res: Response) => {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

    const tenantId = requireTenantId(req);

    const parsed = IntakeDeliveryBodySchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.flatten().fieldErrors,
      });
    }

    const { projectId, deliveryId, occurredAt, location, items, notes } =
      parsed.data;

    const actorUserId = req.header("X-Actor-Id")?.trim();

    const resolvedActorUserId =
      actorUserId && UUID_RE.test(actorUserId) ? actorUserId : null;

    const occurredAtIso =
      occurredAt instanceof Date
        ? occurredAt.toISOString()
        : new Date(occurredAt).toISOString();

    const responsePayload = await prisma.$transaction(async (tx) => {
      const existingCase = await tx.case.findFirst({
        where: {
          id: projectId,
          tenantId,
        },
        select: {
          id: true,
        },
      });

      if (!existingCase) {
        return {
          ok: false as const,
          status: 404 as const,
          error: "CASE_NOT_FOUND",
        };
      }

      const execution = await tx.execution.upsert({
        where: {
          caseId: existingCase.id,
        },
        create: {
          tenantId,
          caseId: existingCase.id,
          status: ExecutionStatus.CREATED,
          startedAt: new Date(),
          startedByUserId: resolvedActorUserId,
        },
        update: {
          startedByUserId: resolvedActorUserId ?? undefined,
        },
        select: { id: true },
      });

      await tx.executionProgress.create({
        data: {
          executionId: execution.id,
          label: "DELIVERY",
          detail: {
            deliveryId,
            occurredAt: occurredAtIso,
            location,
            items,
            notes: notes ?? null,
          } as Prisma.JsonObject,
        },
      });

      await commitLedgerEvent(
        {
          tenantId,
          caseId: existingCase.id,
          eventType: LedgerEventType.EXECUTION_PROGRESS_RECORDED,
          actor: resolvedActorUserId
            ? {
                kind: ActorKind.HUMAN,
                userId: resolvedActorUserId,
                authorityProof: `HUMAN:${resolvedActorUserId}:${key}:${requestHash}`,
              }
            : {
                kind: ActorKind.SYSTEM,
                authorityProof: `SYSTEM:${key}:${requestHash}`,
              },
          intentContext: {
            idempotencyKey: key,
            requestHash,
          },
          payload: {
            caseId: existingCase.id,
            executionId: execution.id,
            deliveryId,
            occurredAt: occurredAtIso,
            location,
            items,
            notes: notes ?? null,
          },
        },
        tx,
      );

      return {
        ok: true,
        type: "EXECUTION_PROGRESS_RECORDED",
        projectId: existingCase.id,
        deliveryId,
      };
    });

    if ((responsePayload as any)?.status === 404) {
      return res.status(404).json({
        ok: false,
        error: `Case not found for projectId=${projectId}`,
      });
    }

    await commitIdempotencyResponse(res, responsePayload);

    return res.status(201).json(responsePayload);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "DELIVERY_INTAKE_FAILED",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Strict schema alignment: no PostWin coupling.
// Enums passed directly from IntakeResult.
// All governance writes wrapped in single transaction.
// Idempotency enforced before persistence.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - handleResolveLocation
// - handleIntakeBootstrap
// - handleIntakeDelivery
// - Zod schemas
// - Small explicit helpers

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Ensure idempotency middleware runs first.
// - Ensure TaskDefinitions seeded per tenant.
// - Map domain errors to HTTP consistently.
// - Do not expose Case directly to frontend without mapper layer.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// This controller isolates governance boundary.
// Future lifecycle transitions should be orchestrated via services,
// not directly mutated here.
////////////////////////////////////////////////////////////////
