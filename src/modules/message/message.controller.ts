// apps/backend/src/modules/message/message.controller.ts
// Purpose: REST controller for message creation and cursor-based pagination with WebSocket broadcast + origin-only ACK.

import type { Request, Response } from "express";
import { MessageService } from "./message.service";
import { publishMessage, publishAck } from "./ws-gateway";

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - tenantId and authorId are derived strictly from auth context.
// - Service layer enforces idempotency via clientMutationId.
// - GET now returns { messages, nextCursor, hasMore } contract.
// - Response shape is stable for UI merge (data = messages).
// - Pagination is cursor-based for deterministic ordering.
// - Limit is clamped defensively to prevent abuse.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - createMessage()
// - getMessagesByCase()
// - Local limit normalization helper

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// - Cursor-based pagination avoids OFFSET drift at scale.
// - Safe for multi-instance via Redis WS gateway.
// - Deterministic idempotent writes.
// - Contract supports infinite scroll without breaking UI.

const service = new MessageService();

////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////

function normalizeLimit(raw: unknown): number {
  let limit = Number(raw ?? 30);

  if (Number.isNaN(limit) || limit <= 0) limit = 30;
  if (limit > 100) limit = 100;

  return limit;
}

////////////////////////////////////////////////////////////////
// POST /api/messages
////////////////////////////////////////////////////////////////

export async function createMessage(req: Request, res: Response) {
  try {
    const auth = (req as any).user;

    if (!auth?.tenantId || !auth?.userId) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
      });
    }

    const {
      caseId,
      parentId,
      type,
      body,
      navigationContext,
      clientMutationId,
    } = req.body ?? {};

    const message = await service.createMessage({
      tenantId: auth.tenantId, // 🔐 enforced
      caseId,
      authorId: auth.userId, // 🔐 enforced
      parentId,
      type,
      body,
      navigationContext,
      clientMutationId,
    });

    //////////////////////////////////////////////////////////////
    // Broadcast to all participants
    //////////////////////////////////////////////////////////////

    publishMessage(caseId, message);

    //////////////////////////////////////////////////////////////
    // Origin-only ACK
    //////////////////////////////////////////////////////////////

    if (clientMutationId) {
      publishAck(caseId, auth.userId, clientMutationId, message.id);
    }

    return res.status(201).json({
      ok: true,
      data: message,
    });
  } catch (err: any) {
    const status =
      err?.message === "CASE_NOT_FOUND"
        ? 404
        : err?.message === "AUTHOR_NOT_IN_TENANT"
          ? 403
          : 400;

    return res.status(status).json({
      ok: false,
      error: err?.message || "Failed to create message",
    });
  }
}

////////////////////////////////////////////////////////////////
// GET /api/messages/:caseId?cursor=&limit=
////////////////////////////////////////////////////////////////

export async function getMessagesByCase(req: Request, res: Response) {
  try {
    const auth = (req as any).user;
    const caseId = req.params.caseId;

    if (!auth?.tenantId || !caseId || Array.isArray(caseId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid parameters",
      });
    }

    //////////////////////////////////////////////////////////////
    // Validate case ownership (explicit isolation)
    //////////////////////////////////////////////////////////////

    const caseExists = await prisma.case.findFirst({
      where: { id: caseId, tenantId: auth.tenantId },
      select: { id: true },
    });

    if (!caseExists) {
      return res.status(404).json({
        ok: false,
        error: "CASE_NOT_FOUND",
      });
    }

    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    const limit = normalizeLimit(req.query.limit);

    const result = await service.getMessagesByCase(
      auth.tenantId,
      caseId,
      cursor,
      limit,
    );

    return res.status(200).json({
      ok: true,
      data: result.messages,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  } catch (err: any) {
    const status = err?.message === "INVALID_CURSOR" ? 400 : 400;

    return res.status(status).json({
      ok: false,
      error: err?.message || "Failed to fetch messages",
    });
  }
}
