import { Request, Response } from "express";
import { VerificationRequestService } from "./requestVerification.service";

const service = new VerificationRequestService();

export async function requestVerification(req: Request, res: Response) {
  try {
    const { tenantId, caseId, requesterUserId, reason } = req.body ?? {};

    if (!tenantId || !caseId || !requesterUserId) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: tenantId, caseId, requesterUserId",
      });
    }

    const result = await service.requestVerification({
      tenantId,
      caseId,
      requesterUserId,
      reason,
    });

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
