// apps/backend/src/modules/execution/execution.routes.ts

import { Router, type Router as ExpressRouter } from "express";
import { startExecution } from "./startExecution.service";
import { ActorKind } from "@prisma/client";

const router: ExpressRouter = Router();

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
      authorityProof: "HEADER_ASSERTED", // replace with real auth proof model later
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

export default router;
