// apps/backend/src/modules/intake/helpers/intake.helpers.ts
// Purpose: Shared helper utilities for intake controllers (idempotency, tenant resolution, author resolution, reference generation)

import crypto from "crypto";
import { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertUuid, UUID_RE } from "@/utils/uuid";

/**
 * Assumption
 * - idempotency.middleware has already populated res.locals.idempotency
 */

export interface IdempotencyMeta {
  key: string;
  requestHash: string;
}

////////////////////////////////////////////////////////////////
// Idempotency
////////////////////////////////////////////////////////////////

export function requireIdempotencyMeta(res: Response): IdempotencyMeta {
  const meta = (res.locals as any).idempotency;

  if (!meta?.key || !meta?.requestHash) {
    throw new Error("IDEMPOTENCY_METADATA_MISSING");
  }

  return meta;
}

////////////////////////////////////////////////////////////////
// Tenant resolution
////////////////////////////////////////////////////////////////

export function requireTenantId(req: Request): string {
  const tenantId = req.header("X-Tenant-Id")?.trim() || "";
  assertUuid(tenantId, "tenantId");
  return tenantId;
}

////////////////////////////////////////////////////////////////
// Actor resolution
////////////////////////////////////////////////////////////////

export async function resolveAuthorUserId(
  req: Request,
  tenantId: string,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const actorHeader = req.header("X-Actor-Id")?.trim();

  if (actorHeader && UUID_RE.test(actorHeader)) {
    return actorHeader;
  }

  const db = tx ?? prisma;

  const user = await db.user.findFirst({
    where: {
      tenantId,
      isActive: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });

  if (!user?.id) {
    throw new Error("NO_ACTIVE_USER_FOR_TENANT");
  }

  return user.id;
}

////////////////////////////////////////////////////////////////
// Reference generation
////////////////////////////////////////////////////////////////

export function generateReferenceCode(): string {
  return `CASE-${Date.now()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Helpers isolate infrastructure logic so controllers stay focused
// on orchestration rather than request parsing.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// requireIdempotencyMeta()
// requireTenantId()
// resolveAuthorUserId()
// generateReferenceCode()

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Import these helpers inside controllers instead of re-implementing
// validation or tenant resolution logic.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// If additional governance rules appear (multi-tenant authorization,
// audit validation, etc.), they can extend these helpers without
// inflating controller size.
