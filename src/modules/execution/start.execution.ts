// apps/backend/src/modules/execution/start.execution.ts

import { Request, Response } from "express";
import { z } from "zod";
import { ActorKind } from "@prisma/client";

import { startExecution } from "./startExecution.service";
import { InvariantViolationError } from "@/modules/cases/case.errors";

const StartExecutionSchema = z.object({
  caseId: z.string().uuid(),
});

export async function startExecutionHandler(req: Request, res: Response) {
  try {
    const tenantId = req.header("X-Tenant-Id");
    const actorUserId = req.header("X-Actor-Id");
    const idempotencyKey = req.header("Idempotency-Key");
    const requestId = req.header("x-request-id");

    if (!tenantId || !actorUserId || !idempotencyKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing required headers",
      });
    }

    const parsed = StartExecutionSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const { caseId } = parsed.data;

    const authorityProof = `HUMAN:${actorUserId}:${idempotencyKey}`;

    const execution = await startExecution({
      tenantId,
      caseId,
      actorKind: ActorKind.HUMAN,
      actorUserId,
      authorityProof,
      intentContext: {
        idempotencyKey,
        requestId,
      },
    });

    return res.status(201).json({
      ok: true,
      executionId: execution.id,
      status: execution.status,
      startedAt: execution.startedAt,
    });
  } catch (err) {
    if (err instanceof InvariantViolationError) {
      return res.status(409).json({
        ok: false,
        error: err.message,
      });
    }

    console.error("EXECUTION_START_ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
    });
  }
}
