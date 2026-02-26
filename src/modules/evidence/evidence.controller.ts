// apps/backend/src/modules/evidence/evidence.controller.ts
// Purpose: Secure Multi-tenant Polymorphic Evidence Controller
// (Presign + Commit + Secure Download + Paginated Listing + Intelligent Audit Logging).

////////////////////////////////////////////////////////////////
// Assumptions
////////////////////////////////////////////////////////////////
// - req.user is populated by authentication middleware.
// - req.user contains: { id?: string; tenantId: string }.
// - EvidenceService enforces strict tenant/domain validation.
// - Prisma schema includes EvidenceDownloadLog with:
//   tenantId, evidenceId, userId?, purpose?, ipAddress?, userAgent?,
//   requestId, riskScore, flagged, createdAt.
// - Error messages from service are safe to expose as codes.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Controller handles HTTP + auth boundary only.
// - Service owns validation + tenant enforcement.
// - Download endpoint performs lightweight behavioral risk scoring.
// - Audit logging must never block UX.
// - Risk query conditionally includes userId to avoid undefined filters.
// - Enforces userId presence to prevent tenant-wide risk aggregation.
// - Download semantics remain separate from metadata endpoints.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - presignEvidence()
// - commitEvidence()
// - downloadEvidence()  <-- UPDATED (safe risk query + userId enforcement)
// - listEvidence()

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import type { Request, Response } from "express";
import { EvidenceService } from "./evidence.service";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const service = new EvidenceService();

////////////////////////////////////////////////////////////////
// STEP 1: Presign
////////////////////////////////////////////////////////////////

export async function presignEvidence(req: Request, res: Response) {
  try {
    if (!req.user?.tenantId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const result = await service.presignUpload({
      ...req.body,
      tenantId: req.user.tenantId,
    });

    return res.status(200).json({ ok: true, data: result });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message ?? "INVALID_UPLOAD_REQUEST",
    });
  }
}

////////////////////////////////////////////////////////////////
// STEP 2: Commit
////////////////////////////////////////////////////////////////

export async function commitEvidence(req: Request, res: Response) {
  try {
    if (!req.user?.tenantId || !req.user?.id) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const evidence = await service.commitEvidence({
      ...req.body,
      tenantId: req.user.tenantId,
      uploadedById: req.user.id,
    });

    return res.status(201).json({ ok: true, data: evidence });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({
        ok: false,
        error:
          "Duplicate file detected. This evidence has already been submitted for this organization.",
      });
    }

    return res.status(400).json({
      ok: false,
      error: err?.message ?? "INVALID_COMMIT_REQUEST",
    });
  }
}

////////////////////////////////////////////////////////////////
// STEP 3: Secure Download + Intelligent Audit Log
////////////////////////////////////////////////////////////////

export async function downloadEvidence(req: Request, res: Response) {
  try {
    if (!req.user?.tenantId || !req.user?.id) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const { id } = req.params;

    const purpose = req.query.purpose === "EXPORT" ? "EXPORT" : "VIEW";

    const result = await service.generateDownloadUrl({
      evidenceId: Array.isArray(id) ? id[0] : id,
      tenantId: req.user.tenantId,
    });

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Safe conditional filter (no undefined in Prisma where)
    const recentDownloads = await prisma.evidenceDownloadLog.count({
      where: {
        tenantId: req.user.tenantId,
        ...(req.user.id ? { userId: req.user.id } : {}),
        createdAt: { gte: fiveMinutesAgo },
      },
    });

    const riskScore = recentDownloads > 20 ? 70 : recentDownloads > 10 ? 40 : 0;

    const flagged = riskScore >= 70;

    prisma.evidenceDownloadLog
      .create({
        data: {
          tenantId: req.user.tenantId,
          evidenceId: result.evidenceId,
          userId: req.user.id,
          purpose,
          ipAddress: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
          requestId: crypto.randomUUID(),
          riskScore,
          flagged,
        },
      })
      .catch(() => {
        // never block download UX
      });

    return res.status(200).json({ ok: true, data: result });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message ?? "DOWNLOAD_FAILED",
    });
  }
}

////////////////////////////////////////////////////////////////
// STEP 4: Paginated Listing
////////////////////////////////////////////////////////////////

export async function listEvidence(req: Request, res: Response) {
  try {
    if (!req.user?.tenantId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const {
      page,
      limit,
      search,
      caseId,
      timelineEntryId,
      caseTaskId,
      verificationRecordId,
      approvalRequestId,
      sort,
    } = req.query;

    const result = await service.listEvidence({
      tenantId: req.user.tenantId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search as string | undefined,
      caseId: caseId as string | undefined,
      timelineEntryId: timelineEntryId as string | undefined,
      caseTaskId: caseTaskId as string | undefined,
      verificationRecordId: verificationRecordId as string | undefined,
      approvalRequestId: approvalRequestId as string | undefined,
      sort: sort === "asc" ? "asc" : "desc",
    });

    return res.status(200).json({ ok: true, data: result });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message ?? "LIST_FAILED",
    });
  }
}

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Ensure composite index on (tenantId, userId, createdAt).
// - Risk scoring remains deterministic and explainable.
// - Move heuristics to dedicated risk module if logic expands.
// - Consider temporary lockout if flagged repeatedly.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// - Conditional filter prevents undefined Prisma behavior.
// - Enforcing userId avoids tenant-wide aggregation risk.
// - Audit remains non-blocking and index-friendly.
// - Architecture supports advanced anomaly detection later.
////////////////////////////////////////////////////////////////
