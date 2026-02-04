// apps/backend/src/modules/verification/verification.controller.ts
import type { Request, Response } from "express";
import { LedgerService } from "../intake/ledger.service";
import { VerificationService } from "./verification.service";

const ledger = new LedgerService();
const verificationService = new VerificationService(ledger);

/**
 * GET /api/verification/:postWinId
 */
export async function getPostWin(req: Request, res: Response) {
  const postWinId = String(req.params.postWinId || "").trim();
  if (!postWinId) {
    return res.status(400).json({ ok: false, error: "Missing postWinId" });
  }

  const postWin = await verificationService.getPostWinById(postWinId);
  if (!postWin) {
    return res.status(404).json({ ok: false, error: "PostWin not found" });
  }

  return res.status(200).json({ ok: true, postWin });
}

/**
 * POST /api/verification/verify
 * body: { postWinId, verifierId, sdgGoal }
 */
export async function verifyPostWin(req: Request, res: Response) {
  const postWinId = String(req.body?.postWinId || "").trim();
  const verifierId = String(req.body?.verifierId || "").trim();
  const sdgGoal = String(req.body?.sdgGoal || "").trim();

  if (!postWinId || !verifierId || !sdgGoal) {
    return res.status(400).json({
      ok: false,
      error: "Missing required fields: postWinId, verifierId, sdgGoal",
    });
  }

  const postWin = await verificationService.getPostWinById(postWinId);
  if (!postWin) {
    return res.status(404).json({ ok: false, error: "PostWin not found" });
  }

  const updated = await verificationService.recordVerification(
    postWin,
    verifierId,
    sdgGoal,
  );

  return res.status(200).json({ ok: true, postWin: updated });
}
