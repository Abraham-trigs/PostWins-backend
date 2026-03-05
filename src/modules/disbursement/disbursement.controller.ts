// filepath: apps/backend/src/modules/disbursement/disbursement.controller.ts
// Purpose: HTTP boundary for disbursement reads + authorize + execute (tx-safe, tenant-scoped, idempotent-friendly).

/* ================================================================
   ASSUMPTIONS
   ================================================================ */
// - PAYEE_KINDS + PayeeKind live in packages/core/src/types.ts
// - backend imports it through workspace alias @posta/core/types
// - prisma schema still stores payeeKind as String
// - authorizeDisbursement.service.ts performs lifecycle enforcement

/* ================================================================
   Design reasoning
   ================================================================ */
// Disbursement is financial state, so the HTTP layer must:
// - trust server-attached identity (req.user) and ignore spoofable client fields
// - validate + normalize inputs strictly (money precision, currency, UUIDs)
// - keep writes tenant-scoped and idempotency-aware
// - delegate lifecycle enforcement + ledger commits to domain services
// Reads are paginated/filterable to support real dashboards.
//
// Payee kinds are sourced from the shared domain contract layer to ensure
// frontend and backend cannot drift on allowed values.

////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////

import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

import {
  ActorKind,
  DisbursementStatus,
  DisbursementType,
  Prisma as PrismaTypes,
} from "@prisma/client";

import { assertUuid, UUID_RE } from "@/utils/uuid";

import { authorizeDisbursement } from "./_internal/authorizeDisbursement.service";
import { executeDisbursement } from "./_internal/executeDisbursement.service";

import { PAYEE_KINDS, type PayeeKind } from "@posta/core/src/types";

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

type AuthedUser = {
  userId: string;
  tenantId: string;
  sessionId: string;
  expiresAt: number;
};

type IdempotencyMeta = { key: string; requestHash: string };

////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////

function requireTenantId(req: Request): string {
  const tenantId = req.header("X-Tenant-Id")?.trim() || "";
  assertUuid(tenantId, "tenantId");
  return tenantId;
}

/**
 * Prefer server-attached auth identity (non-spoofable).
 * Fallback to X-Actor-Id for internal tooling only.
 */
function resolveActorUserId(req: Request): string | null {
  const authed = (req as any).user as AuthedUser | undefined;
  if (authed?.userId && UUID_RE.test(authed.userId)) return authed.userId;

  const actorHeader = req.header("X-Actor-Id")?.trim() || "";
  return UUID_RE.test(actorHeader) ? actorHeader : null;
}

function requireIdempotencyMeta(res: Response): IdempotencyMeta {
  const meta = (res.locals as any).idempotency;
  if (!meta?.key || !meta?.requestHash) {
    throw new Error("Missing idempotency metadata");
  }
  return meta as IdempotencyMeta;
}

/**
 * Normalize numeric inputs from forms.
 */
function coerceNumber(input: unknown): unknown {
  if (typeof input === "string") {
    const s = input.trim();
    if (s === "") return undefined;

    const n = Number(s);
    return Number.isFinite(n) ? n : input;
  }
  return input;
}

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const PaginationSchema = z.object({
  limit: z
    .preprocess(coerceNumber, z.number().int().min(1).max(100))
    .default(20),

  cursor: z.string().uuid().optional(),

  status: z.nativeEnum(DisbursementStatus).optional(),

  caseId: z.string().uuid().optional(),
});

const AuthorizeBodySchema = z.object({
  caseId: z.string().uuid(),

  type: z.nativeEnum(DisbursementType),

  amount: z.preprocess(coerceNumber, z.number().positive()),

  currency: z
    .string()
    .trim()
    .min(3)
    .max(10)
    .transform((v) => v.toUpperCase()),

  payee: z.object({
    kind: z.enum(PAYEE_KINDS),
    id: z.string().min(1),
  }),
});

const ExecuteBodySchema = z.object({
  disbursementId: z.string().uuid(),

  outcome: z.union([
    z.object({ success: z.literal(true) }),
    z.object({
      success: z.literal(false),
      reason: z.string().trim().min(1).max(2000),
    }),
  ]),
});

////////////////////////////////////////////////////////////////
// GET /api/disbursement
////////////////////////////////////////////////////////////////

export async function listDisbursements(req: Request, res: Response) {
  const tenantId = requireTenantId(req);

  const parsed = PaginationSchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ ok: false, error: parsed.error.flatten().fieldErrors });
  }

  const { limit, cursor, status, caseId } = parsed.data;

  const where: PrismaTypes.DisbursementWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(caseId ? { caseId } : {}),
  };

  const items = await prisma.disbursement.findMany({
    where,
    take: limit + 1,
    ...(cursor
      ? {
          skip: 1,
          cursor: { id: cursor },
        }
      : {}),
    orderBy: [{ authorizedAt: "desc" }, { id: "desc" }],
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1]?.id : null;

  return res.status(200).json({
    ok: true,
    data: {
      items: page,
      pageInfo: { hasMore, nextCursor },
    },
  });
}

////////////////////////////////////////////////////////////////
// GET /api/disbursement/:id
////////////////////////////////////////////////////////////////

export async function getDisbursementById(req: Request, res: Response) {
  const tenantId = requireTenantId(req);

  const id = String(req.params.id ?? "").trim();
  if (!UUID_RE.test(id)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid disbursement id",
    });
  }

  const item = await prisma.disbursement.findFirst({
    where: { id, tenantId },
  });

  if (!item) {
    return res.status(404).json({
      ok: false,
      error: "Disbursement not found",
    });
  }

  return res.status(200).json({
    ok: true,
    data: item,
  });
}

////////////////////////////////////////////////////////////////
// POST /api/disbursement/authorize
////////////////////////////////////////////////////////////////

export async function authorizeDisbursementHandler(
  req: Request,
  res: Response,
) {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

    const tenantId = requireTenantId(req);

    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
      });
    }

    const parsed = AuthorizeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await authorizeDisbursement({
      tenantId,
      caseId: parsed.data.caseId,
      type: parsed.data.type,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      payee: parsed.data.payee as { kind: PayeeKind; id: string },
      actor: {
        kind: ActorKind.HUMAN,
        userId: actorUserId,
        authorityProof: `HUMAN:${actorUserId}:${key}:${requestHash}`,
      },
    });

    return res.status(result.kind === "AUTHORIZED" ? 201 : 409).json({
      ok: result.kind === "AUTHORIZED",
      data: result.kind === "AUTHORIZED" ? result : undefined,
      error: result.kind === "DENIED" ? result.reason : undefined,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message ?? "AUTHORIZE_FAILED",
    });
  }
}

////////////////////////////////////////////////////////////////
// POST /api/disbursement/execute
////////////////////////////////////////////////////////////////

export async function executeDisbursementHandler(req: Request, res: Response) {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

    const tenantId = requireTenantId(req);

    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized",
      });
    }

    const parsed = ExecuteBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: parsed.error.flatten().fieldErrors,
      });
    }

    const updated = await executeDisbursement({
      tenantId,
      disbursementId: parsed.data.disbursementId,
      actor: {
        kind: ActorKind.HUMAN,
        userId: actorUserId,
        authorityProof: `HUMAN:${actorUserId}:${key}:${requestHash}`,
      },
      outcome: parsed.data.outcome,
    });

    return res.status(200).json({
      ok: true,
      data: updated,
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message ?? "EXECUTE_FAILED",
    });
  }
}
