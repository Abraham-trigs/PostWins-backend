// apps/backend/src/modules/cases/cases.controller.ts
// Purpose: List cases with authoritative lifecycle + latest message signal + stable composite cursor pagination.

import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { validate as isUuid } from "uuid";
import type {
  CaseListItem,
  RoutingOutcome,
  ListCasesResponse,
} from "@posta/core";

/* ============================================================
   Design reasoning
   ------------------------------------------------------------
   - Stable composite ordering: createdAt DESC, id DESC.
   - Cursor uses unique id for safety.
   - take = limit + 1 to detect next page.
   - Explicit DTO mapping.
   - ISO serialization at boundary.
   ============================================================ */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listCases(
  req: Request,
  res: Response<ListCasesResponse | { ok: false; error: string }>,
): Promise<Response<ListCasesResponse | { ok: false; error: string }>> {
  const tenantId = String(req.header("X-Tenant-Id") || "").trim();
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);

  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing X-Tenant-Id" });
  }

  if (!isUuid(tenantId)) {
    return res.status(400).json({
      ok: false,
      error: "X-Tenant-Id must be a valid UUID",
    });
  }

  if (cursor && !isUuid(cursor)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid cursor",
    });
  }

  const rows = await prisma.case.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
    select: {
      id: true,
      lifecycle: true,
      currentTask: true,
      type: true,
      scope: true,
      sdgGoal: true,
      summary: true,
      createdAt: true,
      updatedAt: true,
      routingDecisions: {
        orderBy: { decidedAt: "desc" },
        take: 1,
        select: { routingOutcome: true },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          body: true,
          type: true,
          createdAt: true,
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  const cases: CaseListItem[] = trimmed.map((row) => {
    const routingOutcome: RoutingOutcome =
      (row.routingDecisions[0]?.routingOutcome as RoutingOutcome) ??
      "UNASSIGNED";

    const lastMessage =
      row.messages[0] !== undefined
        ? {
            body: row.messages[0].body,
            type: row.messages[0].type,
            createdAt: row.messages[0].createdAt.toISOString(),
          }
        : null;

    return {
      id: row.id,
      lifecycle: row.lifecycle,
      currentTask: row.currentTask,
      routingOutcome,
      type: row.type,
      scope: row.scope,
      sdgGoal: row.sdgGoal,
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      lastMessage,
    };
  });

  const nextCursor =
    hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1].id : null;

  return res.status(200).json({
    ok: true,
    cases,
    meta: {
      nextCursor,
      limit,
    },
  });
}

/* ============================================================
   Structure
   ------------------------------------------------------------
   - Header validation
   - Cursor + limit normalization
   - Stable composite ordering
   - Explicit DTO mapping
   - Cursor metadata return
   ============================================================ */

/* ============================================================
   Scalability insight
   ------------------------------------------------------------
   Ensure index exists:
   @@index([tenantId, createdAt, id])
   Without it, pagination degrades under scale.
   ============================================================ */
