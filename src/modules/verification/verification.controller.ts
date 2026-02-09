import type { Request, Response } from "express";
import { LedgerService } from "../intake/ledger.service";
import { VerificationService } from "./verification.service";
import { VerificationStatus } from "@prisma/client";

const ledger = new LedgerService();
const verificationService = new VerificationService(ledger);

/**
 * GET /api/verification/:verificationRecordId
 * Fetch a verification record (read-only)
 */
export async function getVerificationRecord(req: Request, res: Response) {
  const verificationRecordId = String(
    req.params.verificationRecordId || "",
  ).trim();

  if (!verificationRecordId) {
    return res.status(400).json({
      ok: false,
      error: "Missing verificationRecordId",
    });
  }

  const record =
    await verificationService.getVerificationRecordById(verificationRecordId);

  if (!record) {
    return res.status(404).json({
      ok: false,
      error: "Verification record not found",
    });
  }

  return res.status(200).json({
    ok: true,
    record,
  });
}

/**
 * POST /api/verification/vote
 * body: { verificationRecordId, verifierUserId, status, note? }
 *
 * Submits a single verification vote.
 * Does NOT assert truth directly.
 */
export async function submitVerificationVote(req: Request, res: Response) {
  const verificationRecordId = String(
    req.body?.verificationRecordId || "",
  ).trim();

  const verifierUserId = String(req.body?.verifierUserId || "").trim();

  const status = req.body?.status as VerificationStatus;
  const note = req.body?.note as string | undefined;

  if (!verificationRecordId || !verifierUserId || !status) {
    return res.status(400).json({
      ok: false,
      error:
        "Missing required fields: verificationRecordId, verifierUserId, status",
    });
  }

  if (
    status !== VerificationStatus.ACCEPTED &&
    status !== VerificationStatus.REJECTED
  ) {
    return res.status(400).json({
      ok: false,
      error: "Invalid verification status",
    });
  }

  try {
    const result = await verificationService.recordVerification(
      verificationRecordId,
      verifierUserId,
      status,
      note,
    );

    return res.status(200).json({
      ok: true,
      result,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}
