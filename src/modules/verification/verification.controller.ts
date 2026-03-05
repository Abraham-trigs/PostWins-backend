// filepath: apps/backend/src/modules/verification/verification.controller.ts
// Purpose: Verification endpoints (request round, vote, retrieve) with tx-safe message + ledger orchestration.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Auth is enforced at /api via authMiddleware, so we must prefer server-attached identity (req.user) to avoid spoofed headers.
// Controller owns HTTP boundaries + composition, while domain services own rules (invariants, consensus, decision effects).
// Verification request must create a UI Message and the governance VerificationRecord/ledger fact atomically to prevent drift.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - getVerificationRecord(): GET /api/verification/:verificationRecordId
// - submitVerificationVote(): POST /api/verification/vote
// - requestVerification(): POST /api/verification/request

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Mount POST endpoints behind idempotencyGuard.
// - Require X-Tenant-Id.
// - Prefer (req as any).user.userId; only fall back to X-Actor-Id for internal tooling.
// - Do NOT trust client-supplied verifierUserId; infer it from auth identity.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Server-derived identity makes audit trails reliable and allows future RBAC hardening.
// This controller boundary is where you can later add rate-limits, notification fanout, and SLA timers without touching domain rules.

import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { assertUuid, UUID_RE } from "@/utils/uuid";
import { MessageType, Prisma as PrismaTypes } from "@prisma/client";

import { OrchestratorService } from "@/modules/orchestrator/orchestrator.service";
import { DecisionOrchestrationService } from "@/modules/decision/decision-orchestration.service";
import { DecisionService } from "@/modules/decision/decision.service";
import { VerificationService } from "./verification.service";
import { VerificationRequestService } from "./requestVerification.service";

////////////////////////////////////////////////////////////////
// Local helpers
////////////////////////////////////////////////////////////////

type AuthedUser = {
  userId: string;
  tenantId: string;
  sessionId: string;
  expiresAt: number;
};

function requireTenantId(req: Request): string {
  const tenantId = req.header("X-Tenant-Id")?.trim() || "";
  assertUuid(tenantId, "tenantId");
  return tenantId;
}

function requireIdempotencyMeta(res: Response) {
  const meta = (res.locals as any).idempotency;
  if (!meta?.key || !meta?.requestHash) {
    throw new Error("Missing idempotency metadata");
  }
  return meta as { key: string; requestHash: string };
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

////////////////////////////////////////////////////////////////
// Composition root (kept local + explicit)
////////////////////////////////////////////////////////////////

const orchestratorService = new OrchestratorService();
const decisionOrchestrator = new DecisionOrchestrationService(
  orchestratorService,
);
const decisionService = new DecisionService(decisionOrchestrator);

// ✅ Updated ctor: VerificationService no longer takes LedgerService directly.
// All ledger commits happen via commitLedgerEvent inside the service.
const verificationService = new VerificationService(decisionService);

const verificationRequestService = new VerificationRequestService();

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const RequestVerificationBodySchema = z.object({
  caseId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000).optional(),
  requiredRoleKeys: z.array(z.string().min(1)).min(1).optional(),
  requiredVerifiers: z.number().int().min(1).max(50).optional(),
});

const SubmitVoteBodySchema = z.object({
  verificationRecordId: z.string().uuid(),

  // ⚠️ client may send this, but we do NOT trust it.
  verifierUserId: z.string().uuid().optional(),

  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(4000).optional(),
});

////////////////////////////////////////////////////////////////
// GET /api/verification/:verificationRecordId
////////////////////////////////////////////////////////////////

export async function getVerificationRecord(req: Request, res: Response) {
  const verificationRecordId = String(
    req.params.verificationRecordId || "",
  ).trim();

  if (!verificationRecordId) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing verificationRecordId" });
  }

  const record =
    await verificationService.getVerificationRecordById(verificationRecordId);

  if (!record) {
    return res
      .status(404)
      .json({ ok: false, error: "Verification record not found" });
  }

  return res.status(200).json({ ok: true, record });
}

////////////////////////////////////////////////////////////////
// POST /api/verification/vote
////////////////////////////////////////////////////////////////

export async function submitVerificationVote(req: Request, res: Response) {
  try {
    // idempotencyGuard ensures this exists and prevents duplicates.
    requireIdempotencyMeta(res);

    const tenantId = requireTenantId(req);

    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized (missing authenticated user / X-Actor-Id)",
      });
    }

    const parsed = SubmitVoteBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, error: parsed.error.flatten().fieldErrors });
    }

    // ✅ Never trust client-supplied verifierUserId; infer from auth identity.
    const result = await verificationService.recordVerification({
      verificationRecordId: parsed.data.verificationRecordId,
      verifierUserId: actorUserId,
      status: parsed.data.status,
      note: parsed.data.note,
      // tenantId not needed by service (record lookup is authoritative), but kept here as a guard for future.
      tenantId,
    });

    return res.status(200).json({ ok: true, result });
  } catch (err: any) {
    return res
      .status(400)
      .json({ ok: false, error: err?.message ?? "VOTE_FAILED" });
  }
}

////////////////////////////////////////////////////////////////
// POST /api/verification/request
////////////////////////////////////////////////////////////////

export async function requestVerification(req: Request, res: Response) {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);
    const tenantId = requireTenantId(req);

    const actorUserId = resolveActorUserId(req);
    if (!actorUserId) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized (missing authenticated user / X-Actor-Id)",
      });
    }

    const parsed = RequestVerificationBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ ok: false, error: parsed.error.flatten().fieldErrors });
    }

    const { caseId, reason, requiredRoleKeys, requiredVerifiers } = parsed.data;

    const data = await prisma.$transaction(
      async (tx: PrismaTypes.TransactionClient) => {
        // Ensure case exists (tenant-scoped)
        const exists = await tx.case.findFirst({
          where: { id: caseId, tenantId },
          select: { id: true },
        });

        if (!exists) {
          return {
            ok: false as const,
            status: 404 as const,
            error: "CASE_NOT_FOUND",
          };
        }

        // 1) Create message (UI signal)
        const message = await tx.message.create({
          data: {
            tenantId,
            caseId,
            authorId: actorUserId,
            type: MessageType.VERIFICATION_REQUEST,
            body: reason ?? "Verification has been formally requested.",
            navigationContext: {
              target: "VERIFY",
              id: "VERIFICATION_PANEL",
              params: { focus: true },
            } as any,
          },
          select: { id: true },
        });

        // 2) Ensure verification round + ledger commit (atomic)
        const round = await verificationRequestService.requestVerification(
          {
            tenantId,
            caseId,
            requesterUserId: actorUserId,
            reason,
            requiredRoleKeys,
            requiredVerifiers,
            idempotency: { key, requestHash },
          },
          tx,
        );

        return {
          ok: true as const,
          messageId: message.id,
          verificationRecordId: round.verificationRecordId,
          created: round.created,
        };
      },
    );

    if ((data as any)?.status === 404) {
      return res
        .status(404)
        .json({ ok: false, error: `Case not found for caseId=${caseId}` });
    }

    return res.status(201).json({ ok: true, data });
  } catch (err: any) {
    return res
      .status(400)
      .json({ ok: false, error: err?.message ?? "REQUEST_FAILED" });
  }
}

////////////////////////////////////////////////////////////////
// Integration notes
////////////////////////////////////////////////////////////////
// - Ensure app.ts CORS allows: X-Actor-Id, X-Device-Id, X-Tenant-Id
// - Ensure authMiddleware attaches (req as any).user
// - Routes must include POST /request with idempotencyGuard
