// filepath: apps/backend/src/modules/verification/verification.controller.ts
// Purpose: Orchestrates verification requests, votes, and record retrieval.
// Implements Option B (backend-owned workflow orchestration).

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Verification request is a workflow boundary.
// It must:
// - Create a signal message (conversation layer)
// - Trigger authoritative ledger request
// - Remain atomic
// - Preserve lifecycle law
//
// Message layer remains stateless.
// Ledger + lifecycle remain inside verification domain.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - GET verification record
// - POST verification vote
// - POST verification request (NEW orchestration boundary)

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Never let frontend coordinate verification state
// - Keep message + ledger inside same transaction
// - Never mutate lifecycle directly here
// - Defer lifecycle transitions to finalization module

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// This orchestration pattern prevents UI-driven drift,
// ensures deterministic ledger recording,
// and centralizes workflow boundaries for future expansion.

import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { LedgerService } from "../intake/ledger/ledger.service";
import { VerificationService } from "./verification.service";
import { VerificationRequestService } from "./requestVerification.service";
import { MessageService } from "../message/message.service";
import { VerificationStatus, MessageType, Prisma } from "@prisma/client";
import { assertUuid } from "@/utils/uuid";

const ledger = new LedgerService();
const verificationService = new VerificationService(ledger, null as any); // DecisionService already injected elsewhere
const verificationRequestService = new VerificationRequestService();
const messageService = new MessageService();

////////////////////////////////////////////////////////////////
// GET /api/verification/:verificationRecordId
////////////////////////////////////////////////////////////////

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

////////////////////////////////////////////////////////////////
// POST /api/verification/vote
////////////////////////////////////////////////////////////////

export async function submitVerificationVote(req: Request, res: Response) {
  const { verificationRecordId, verifierUserId, status, note } = req.body ?? {};

  if (!verificationRecordId || !verifierUserId || !status) {
    return res.status(400).json({
      ok: false,
      error:
        "Missing required fields: verificationRecordId, verifierUserId, status",
    });
  }

  if (
    status !== VerificationStatus.APPROVED &&
    status !== VerificationStatus.REJECTED
  ) {
    return res.status(400).json({
      ok: false,
      error: "Invalid verification status",
    });
  }

  try {
    const result = await verificationService.recordVerification({
      verificationRecordId,
      verifierUserId,
      status,
      note,
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

////////////////////////////////////////////////////////////////
// POST /api/verification/request
// Orchestrated Verification Request (Option B)
////////////////////////////////////////////////////////////////

export async function requestVerification(req: Request, res: Response) {
  const { tenantId, caseId, requesterUserId, reason } = req.body ?? {};

  if (!tenantId || !caseId || !requesterUserId) {
    return res.status(400).json({
      ok: false,
      error: "Missing required fields: tenantId, caseId, requesterUserId",
    });
  }

  try {
    assertUuid(tenantId, "tenantId");
    assertUuid(caseId, "caseId");
    assertUuid(requesterUserId, "requesterUserId");

    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        ////////////////////////////////////////////////////////////////
        // 1️⃣ Create VERIFICATION_REQUEST message
        ////////////////////////////////////////////////////////////////

        const message = await tx.message.create({
          data: {
            tenantId,
            caseId,
            authorId: requesterUserId,
            type: MessageType.VERIFICATION_REQUEST,
            body: reason ?? "Verification has been formally requested.",
            navigationContext: {
              target: "TASK",
              id: "VERIFY_CASE",
              params: { focus: true },
            },
          },
        });

        ////////////////////////////////////////////////////////////////
        // 2️⃣ Trigger authoritative verification request
        ////////////////////////////////////////////////////////////////

        await verificationRequestService.requestVerification({
          tenantId,
          caseId,
          requesterUserId,
          reason,
        });

        return { message };
      },
    );

    return res.status(201).json({
      ok: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}
