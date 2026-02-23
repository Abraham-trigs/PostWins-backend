// apps/backend/src/modules/auth/provision-verifier.controller.ts

import { Request, Response } from "express";
import { ApprovalGateService } from "../approvals/approval-gate.service";
import { z } from "zod";

const schema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  email: z.string().email(),
  roleKey: z.string().min(1),
  reason: z.string().min(5),
});

const gate = new ApprovalGateService();

export async function proposeVerifierProvision(req: Request, res: Response) {
  try {
    const { tenantId, caseId, email, roleKey, reason } = schema.parse(req.body);

    const approval = await gate.propose({
      tenantId,
      caseId,
      policyKey: "PROVISION_VERIFIER",
      reason,
      effect: {
        kind: "PROVISION_VERIFIER",
        payload: {
          email,
          roleKey,
        },
      },
    });

    return res.status(200).json({
      ok: true,
      approvalRequestId: approval.id,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}
