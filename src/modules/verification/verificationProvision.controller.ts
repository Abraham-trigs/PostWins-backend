// apps/backend/src/modules/verification/verificationProvision.controller.ts
// Purpose: Propose governance-gated verifier provisioning.

import { Request, Response } from "express";
import { ApprovalGateService } from "@/modules/approvals/approval-gate.service";
import { z } from "zod";

const service = new ApprovalGateService();

const Schema = z.object({
  email: z.string().email(),
  roleKey: z.string().min(1),
  reason: z.string().min(5),
});

export async function proposeVerifierProvision(req: Request, res: Response) {
  try {
    const { caseId } = req.params;
    const requester = (req as any).user;

    if (!requester) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const parsed = Schema.parse(req.body);

    const proposal = await service.propose({
      tenantId: requester.tenantId,
      caseId,
      policyKey: "CASE_VERIFIER_PROVISION",
      effect: {
        kind: "PROVISION_VERIFIER",
        payload: {
          email: parsed.email,
          roleKey: parsed.roleKey,
        },
      },
      reason: parsed.reason,
    });

    return res.status(200).json({
      ok: true,
      approvalRequestId: proposal.id,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}
