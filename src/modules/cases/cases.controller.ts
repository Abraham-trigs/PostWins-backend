// apps/backend/src/modules/cases/cases.controller.ts
// Purpose: List cases with authoritative lifecycle + workflow pointer + latest message + stable cursor pagination.

import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { validate as isUuid } from "uuid";
import type { ListCasesResponse } from "@posta/core";
import {
  mapCaseListItems,
  type CaseListQueryRow,
} from "../../shared/mappers/caseList.mapper";

/* ============================================================
   Assumptions
   ------------------------------------------------------------
   - Case model uses `currentTaskDefinitionId`
   - Relation name: currentTaskDefinition
   - JWT middleware attaches req.user.tenantId
   - Composite index exists:
     @@index([tenantId, createdAt(sort: Desc), id(sort: Desc)])
   - CaseListItem DTO is defined in @posta/core
   ============================================================ */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listCases(
  req: Request,
  res: Response<ListCasesResponse | { ok: false; error: string }>,
): Promise<Response<ListCasesResponse | { ok: false; error: string }>> {
  ////////////////////////////////////////////////////////////
  // Auth
  ////////////////////////////////////////////////////////////

  const auth = (req as any).user;

  if (!auth?.tenantId) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  const tenantId: string = auth.tenantId;

  ////////////////////////////////////////////////////////////
  // Query normalization
  ////////////////////////////////////////////////////////////

  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

  const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);

  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : DEFAULT_LIMIT;

  if (cursor && !isUuid(cursor)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid cursor",
    });
  }

  ////////////////////////////////////////////////////////////
  // Query (tenant isolated + workflow aligned)
  ////////////////////////////////////////////////////////////

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
      type: true,
      scope: true,
      sdgGoal: true,
      summary: true,
      createdAt: true,
      updatedAt: true,

      currentTaskDefinitionId: true,
      currentTaskDefinition: {
        select: {
          id: true,
          label: true,
        },
      },

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

  ////////////////////////////////////////////////////////////
  // Pagination trim
  ////////////////////////////////////////////////////////////

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  ////////////////////////////////////////////////////////////
  // DTO mapping (strict boundary via shared mapper)
  ////////////////////////////////////////////////////////////

  const cases = mapCaseListItems(trimmed as CaseListQueryRow[]);

  const nextCursor =
    hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1].id : null;

  ////////////////////////////////////////////////////////////
  // Response
  ////////////////////////////////////////////////////////////

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
   Design reasoning
   ------------------------------------------------------------
   The controller now strictly orchestrates:
   - Authentication
   - Query normalization
   - Tenant-isolated data retrieval
   - Pagination control

   All projection logic has been delegated to a shared mapper,
   enforcing a clean separation between persistence and transport
   contracts. This prevents DTO drift and duplicated mapping logic.
   ============================================================ */

/* ============================================================
   Structure
   ------------------------------------------------------------
   - Auth guard
   - Query normalization
   - Tenant-isolated Prisma query
   - Stable cursor trim
   - Shared DTO mapping layer
   - Structured JSON response
   ============================================================ */

/* ============================================================
   Implementation guidance
   ------------------------------------------------------------
   If additional fields are added to CaseListItem:
   1. Update the Prisma select here.
   2. Update CaseListQueryRow in the mapper.
   3. Update mapCaseListItem().
   The controller should never shape DTO fields directly.
   ============================================================ */

/* ============================================================
   Scalability insight
   ------------------------------------------------------------
   This structure allows:
   - Swapping Prisma with a read-model cache later
   - Moving to projection tables without API changes
   - Centralized DTO evolution

   The controller remains stable even if storage changes.
   ============================================================ */
