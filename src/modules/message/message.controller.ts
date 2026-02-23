// apps/backend/src/modules/message/message.controller.ts
// Purpose: REST controller for message creation and cursor-based pagination with WebSocket broadcast + origin-only ACK.

import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma"; // ✅ direct singleton import
import { MessageService } from "./message.service";
import { publishMessage, publishAck } from "./ws-gateway";

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Prisma is imported as a guaranteed singleton (never optional).
// - tenantId and authorId are strictly derived from auth context.
// - Service layer enforces idempotency via clientMutationId.
// - GET returns stable pagination contract for infinite scroll.
// - Cursor-based pagination avoids OFFSET drift at scale.
// - Defensive limit clamping prevents abuse.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - normalizeLimit()
// - createMessage()
// - getMessagesByCase()

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// - Explicit tenant isolation at query boundary.
// - Safe for multi-instance WS via Redis.
// - Deterministic writes + idempotent handling.
// - Cursor-based pagination scales cleanly under high write volume.

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
      tenantId: auth.tenantId,
      caseId,
      authorId: auth.userId,
      parentId,
      type,
      body,
      navigationContext,
      clientMutationId,
    });

    // Broadcast to all participants
    publishMessage(caseId, message);

    // Origin-only ACK
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
    // Explicit tenant isolation
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
