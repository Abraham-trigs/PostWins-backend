// apps/backend/src/modules/intake/controllers/intake.delivery.controller.ts
// Purpose: Record execution delivery progress for a case

import { Request, Response } from "express";
import {
  ActorKind,
  ExecutionStatus,
  LedgerEventType,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { commitIdempotencyResponse } from "@/middleware/idempotency.middleware";

import {
  requireIdempotencyMeta,
  requireTenantId,
} from "../helpers/intake.helpers";

import { IntakeDeliveryBodySchema } from "../validators/intake.delivery.schema";
import { UUID_RE } from "@/utils/uuid";

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
        where: { id: projectId, tenantId },
        select: { id: true },
      });

      if (!existingCase) {
        return {
          ok: false as const,
          status: 404 as const,
          error: "CASE_NOT_FOUND",
        };
      }

      const execution = await tx.execution.upsert({
        where: { caseId: existingCase.id },
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
          intentContext: { idempotencyKey: key, requestHash },
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
// Delivery controller records real-world implementation events
// while maintaining ledger audit guarantees.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// handleIntakeDelivery()

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Use idempotency middleware before this handler.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Execution progress entries allow analytics on delivery patterns,
// throughput, and field performance.
