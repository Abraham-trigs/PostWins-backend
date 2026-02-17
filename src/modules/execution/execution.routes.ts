// apps/backend/src/modules/execution/execution.routes.ts

import { Router, type Router as ExpressRouter } from "express";
import { startExecution } from "./startExecution.service";
import { CompleteMilestoneService } from "./completeMilestone.service";
import { ExecutionProgressService } from "./execution-progress.service";
import { ActorKind } from "@prisma/client";
import crypto from "crypto";

const router: ExpressRouter = Router();

const completeMilestoneService = new CompleteMilestoneService();
const executionProgressService = new ExecutionProgressService();

/**
 * Start Execution
 */
router.post("/start", async (req, res, next) => {
  try {
    const tenantId = req.header("X-Tenant-Id");
    const actorUserId = req.header("X-Actor-Id");
    const { caseId } = req.body;

    if (!tenantId || !actorUserId || !caseId) {
      return res.status(400).json({
        ok: false,
        error: "Missing required headers or body fields",
      });
    }

    const execution = await startExecution({
      tenantId,
      caseId,
      actorKind: ActorKind.HUMAN,
      actorUserId,
      authorityProof: "HEADER_ASSERTED",
      intentContext: undefined,
    });

    return res.status(201).json({
      ok: true,
      data: execution,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Complete Milestone
 */
router.post("/milestones/complete", async (req, res, next) => {
  try {
    const tenantId = req.header("X-Tenant-Id");
    const actorUserId = req.header("X-Actor-Id");
    const idempotencyKey = req.header("Idempotency-Key");
    const { milestoneId } = req.body;

    if (!tenantId || !actorUserId || !milestoneId || !idempotencyKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing required headers or body fields",
      });
    }

    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(req.body))
      .digest("hex");

    const result = await completeMilestoneService.complete({
      tenantId,
      milestoneId,
      actorUserId,
      idempotencyKey,
      requestHash,
    });

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Execution Progress (Derived Projection)
 */
router.get("/:caseId/progress", async (req, res, next) => {
  try {
    const tenantId = req.header("X-Tenant-Id");
    const { caseId } = req.params;

    if (!tenantId) {
      return res.status(400).json({
        ok: false,
        error: "Missing X-Tenant-Id header",
      });
    }

    const progress = await executionProgressService.getProgress(
      tenantId,
      caseId,
    );

    return res.json({
      ok: true,
      data: progress,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
