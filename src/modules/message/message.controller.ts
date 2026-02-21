import type { Request, Response } from "express";
import { MessageService } from "./message.service";

const service = new MessageService();

////////////////////////////////////////////////////////////////
// POST /api/messages
////////////////////////////////////////////////////////////////

export async function createMessage(req: Request, res: Response) {
  try {
    const {
      tenantId,
      caseId,
      authorId,
      parentId,
      type,
      body,
      navigationContext,
    } = req.body ?? {};

    const message = await service.createMessage({
      tenantId,
      caseId,
      authorId,
      parentId,
      type,
      body,
      navigationContext,
    });

    return res.status(201).json({
      ok: true,
      data: message,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message || "An error occurred while creating the message",
    });
  }
}

////////////////////////////////////////////////////////////////
// GET /api/messages/:tenantId/:caseId
////////////////////////////////////////////////////////////////

export async function getMessagesByCase(req: Request, res: Response) {
  try {
    const rawTenantId = req.params.tenantId;
    const rawCaseId = req.params.caseId;

    // Explicit narrowing — no casting
    if (
      !rawTenantId ||
      !rawCaseId ||
      Array.isArray(rawTenantId) ||
      Array.isArray(rawCaseId)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid tenantId or caseId in path parameters",
      });
    }

    const tenantId = rawTenantId;
    const caseId = rawCaseId;

    const messages = await service.getMessagesByCase(tenantId, caseId);

    return res.status(200).json({
      ok: true,
      data: messages,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message || "Failed to fetch messages",
    });
  }
}
