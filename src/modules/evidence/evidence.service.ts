// apps/backend/src/modules/evidence/evidence.service.ts
// Purpose: Secure, tenant-safe evidence domain logic
// (presign + commit + secure download + relational listing + atomic attachment).

////////////////////////////////////////////////////////////////
// Assumptions
//////////////////////////////////////////////////////////////// validateTargetOwnership
// - Prisma schema includes:
//     @@unique([tenantId, sha256])
// - Evidence model includes `kind` column.
// - Zod schemas enforce XOR invariant for polymorphic targets.
// - Controller maps Prisma P2002 → DUPLICATE_EVIDENCE_SHA256.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - DB uniqueness is sole race-safe duplicate guarantee.
// - Presign duplicate check is UX optimization only.
// - commitEvidence relies on DB constraint for correctness.
// - Filename sanitized to prevent path structure mutation.
// - attachToTimelineEntry preserves atomic invariants.
// - listEvidence exposes curated fields only.
// - Ownership validation remains centralized.

////////////////////////////////////////////////////////////////

import { prisma } from "@/lib/prisma";
import { presignPutObject, presignGetObject } from "@/lib/config/s3";
import { PresignSchema, CommitEvidenceSchema } from "./evidence.validation";
import { Prisma, EvidenceKind, TimelineEntry } from "@prisma/client";
import crypto from "crypto";

type TargetInput = {
  timelineEntryId?: string | null;
  caseTaskId?: string | null;
  verificationRecordId?: string | null;
  approvalRequestId?: string | null;
};

export class EvidenceService {
  ////////////////////////////////////////////////////////////////
  // Presign Upload (Sanitized Filename)
  ////////////////////////////////////////////////////////////////

  async presignUpload(input: unknown) {
    const parsed = PresignSchema.parse(input);

    const {
      tenantId,
      caseId,
      timelineEntryId,
      caseTaskId,
      verificationRecordId,
      approvalRequestId,
      kind,
      mimeType,
      sha256,
      filename,
    } = parsed;

    // UX-level duplicate check (DB is final authority)
    await this.assertNoDuplicateSha(tenantId, sha256);

    await this.validateTargetOwnership({
      tenantId,
      caseId,
      timelineEntryId,
      caseTaskId,
      verificationRecordId,
      approvalRequestId,
    });

    const uniqueSegment = crypto.randomUUID();
    const safeFilename = filename.replace(/[\\/]/g, "_");

    const attachmentScope =
      timelineEntryId ??
      caseTaskId ??
      verificationRecordId ??
      approvalRequestId;

    const storageKey = [
      tenantId,
      caseId,
      attachmentScope,
      kind,
      `${uniqueSegment}-${safeFilename}`,
    ].join("/");

    const presigned = await presignPutObject({
      key: storageKey,
      contentType: mimeType,
      sha256,
    });

    return {
      ...presigned,
      storageKey,
      expectedSha256: sha256,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Commit Evidence (Race-safe via DB constraint)
  ////////////////////////////////////////////////////////////////

  async commitEvidence(input: unknown) {
    const parsed = CommitEvidenceSchema.parse(input);

    const {
      tenantId,
      caseId,
      timelineEntryId,
      caseTaskId,
      verificationRecordId,
      approvalRequestId,
      storageKey,
      sha256,
      mimeType,
      byteSize,
      title,
      originalFilename,
      description,
      uploadedById,
      kind,
    } = parsed;

    return prisma.$transaction(async (tx) => {
      await this.validateTargetOwnership(
        {
          tenantId,
          caseId,
          timelineEntryId,
          caseTaskId,
          verificationRecordId,
          approvalRequestId,
        },
        tx,
      );

      // DB uniqueness guarantees race safety
      return tx.evidence.create({
        data: {
          tenantId,
          caseId: caseId ?? null,
          kind,
          storageProvider: "AWS_S3",
          storageKey,
          sha256,
          mimeType: mimeType ?? null,
          byteSize: byteSize ?? null,
          title: title ?? null,
          originalFilename: originalFilename ?? null,
          description: description ?? null,
          uploadedById: uploadedById ?? null,
          timelineEntryId: timelineEntryId ?? null,
          caseTaskId: caseTaskId ?? null,
          verificationRecordId: verificationRecordId ?? null,
          approvalRequestId: approvalRequestId ?? null,
        },
      });
    });
  }

  ////////////////////////////////////////////////////////////////
  // Secure Download
  ////////////////////////////////////////////////////////////////

  async generateDownloadUrl(params: { evidenceId: string; tenantId: string }) {
    const { evidenceId, tenantId } = params;

    const evidence = await prisma.evidence.findFirst({
      where: { id: evidenceId, tenantId },
      select: { id: true, storageKey: true },
    });

    if (!evidence) {
      throw new Error("EVIDENCE_NOT_FOUND_OR_FORBIDDEN");
    }

    const signed = await presignGetObject({
      key: evidence.storageKey,
    });

    return {
      evidenceId: evidence.id,
      ...signed,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Paginated Listing (Curated Fields Only)
  ////////////////////////////////////////////////////////////////

  async listEvidence(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    search?: string;
    caseId?: string;
    timelineEntryId?: string;
    caseTaskId?: string;
    verificationRecordId?: string;
    approvalRequestId?: string;
    sort?: "asc" | "desc";
  }) {
    const {
      tenantId,
      page = 1,
      limit = 20,
      search,
      caseId,
      timelineEntryId,
      caseTaskId,
      verificationRecordId,
      approvalRequestId,
      sort = "desc",
    } = params;

    const skip = (page - 1) * limit;

    const where: Prisma.EvidenceWhereInput = {
      tenantId,
      ...(caseId ? { caseId } : {}),
      ...(timelineEntryId ? { timelineEntryId } : {}),
      ...(caseTaskId ? { caseTaskId } : {}),
      ...(verificationRecordId ? { verificationRecordId } : {}),
      ...(approvalRequestId ? { approvalRequestId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { originalFilename: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.evidence.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: sort },
        select: {
          id: true,
          caseId: true,
          kind: true,
          title: true,
          originalFilename: true,
          mimeType: true,
          byteSize: true,
          createdAt: true,
          timelineEntryId: true,
          caseTaskId: true,
          verificationRecordId: true,
          approvalRequestId: true,
        },
      }),
      prisma.evidence.count({ where }),
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Atomic Attachment (Bulk Duplicate Detection Optimized)
  ////////////////////////////////////////////////////////////////

  async attachToTimelineEntry(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      caseId: string;
      timelineEntryId: string;
      uploadedById: string;
      evidence: Array<{
        kind: EvidenceKind;
        storageKey: string;
        sha256: string;
        mimeType?: string | null;
        byteSize?: number | null;
      }>;
    },
  ) {
    const { tenantId, caseId, timelineEntryId, uploadedById, evidence } =
      params;

    await this.validateTargetOwnership(
      { tenantId, caseId, timelineEntryId },
      tx,
    );

    const shas = evidence.map((e) => e.sha256);

    const existing = await tx.evidence.findMany({
      where: {
        tenantId,
        sha256: { in: shas },
      },
      select: { sha256: true },
    });

    if (existing.length > 0) {
      throw new Error("DUPLICATE_EVIDENCE_SHA256");
    }

    await tx.evidence.createMany({
      data: evidence.map((e) => ({
        tenantId,
        caseId,
        kind: e.kind,
        storageProvider: "AWS_S3",
        storageKey: e.storageKey,
        sha256: e.sha256,
        mimeType: e.mimeType ?? null,
        byteSize: e.byteSize ?? null,
        uploadedById,
        timelineEntryId,
      })),
    });
  }

  ////////////////////////////////////////////////////////////////
  // Helpers
  ////////////////////////////////////////////////////////////////

  private async assertNoDuplicateSha(tenantId: string, sha256: string) {
    const duplicate = await prisma.evidence.findFirst({
      where: { tenantId, sha256 },
      select: { id: true },
    });

    if (duplicate) {
      throw new Error("DUPLICATE_EVIDENCE_SHA256");
    }
  }

  private async validateTargetOwnership(
    {
      tenantId,
      caseId,
      timelineEntryId,
      caseTaskId,
      verificationRecordId,
      approvalRequestId,
    }: {
      tenantId: string;
      caseId?: string;
    } & TargetInput,
    tx: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    const buildWhere = (id: string) => ({
      id,
      tenantId,
      ...(caseId ? { caseId } : {}),
    });

    if (timelineEntryId) {
      const exists = await tx.timelineEntry.findFirst({
        where: buildWhere(timelineEntryId),
        select: { id: true },
      });
      if (!exists) throw new Error("TIMELINE_ENTRY_NOT_FOUND_OR_FORBIDDEN");
    }

    if (caseTaskId) {
      const exists = await tx.caseTask.findFirst({
        where: buildWhere(caseTaskId),
        select: { id: true },
      });
      if (!exists) throw new Error("CASE_TASK_NOT_FOUND_OR_FORBIDDEN");
    }

    if (verificationRecordId) {
      const exists = await tx.verificationRecord.findFirst({
        where: buildWhere(verificationRecordId),
        select: { id: true },
      });
      if (!exists)
        throw new Error("VERIFICATION_RECORD_NOT_FOUND_OR_FORBIDDEN");
    }

    if (approvalRequestId) {
      const exists = await tx.approvalRequest.findFirst({
        where: buildWhere(approvalRequestId),
        select: { id: true },
      });
      if (!exists) throw new Error("APPROVAL_REQUEST_NOT_FOUND_OR_FORBIDDEN");
    }
  }
}
