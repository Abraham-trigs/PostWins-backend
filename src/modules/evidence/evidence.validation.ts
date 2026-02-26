// apps/backend/src/modules/evidence/evidence.validation.ts
// Purpose: Zod schemas for secure polymorphic evidence presign and commit flows with strict XOR enforcement.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Centralizes XOR (exclusive arc) validation.
// - Ensures presign and commit share consistent structural guarantees.
// - Adds caseId to Commit schema for tenant + case alignment validation.
// - Prevents schema/service drift.
// - Regex-based SHA256 validation protects integrity assumptions.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - PolymorphicTargetFields
// - enforceExactlyOneTarget()
// - PresignSchema
// - CommitEvidenceSchema

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import { z } from "zod";
import { EvidenceKind } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Shared Target Validation (Exclusive Arc)
////////////////////////////////////////////////////////////////

const PolymorphicTargetFields = {
  timelineEntryId: z.string().uuid().optional(),
  caseTaskId: z.string().uuid().optional(),
  verificationRecordId: z.string().uuid().optional(),
  approvalRequestId: z.string().uuid().optional(),
};

function enforceExactlyOneTarget(data: unknown) {
  const d = data as Record<string, unknown>;

  const targets = [
    d.timelineEntryId,
    d.caseTaskId,
    d.verificationRecordId,
    d.approvalRequestId,
  ].filter(Boolean);

  return targets.length === 1;
}

////////////////////////////////////////////////////////////////
// Presign Schema
////////////////////////////////////////////////////////////////

export const PresignSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid(),

    ...PolymorphicTargetFields,

    kind: z.nativeEnum(EvidenceKind),

    filename: z.string().min(1).max(255),
    mimeType: z.string().min(3).max(255),
    byteSize: z.number().int().positive(),

    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .refine(enforceExactlyOneTarget, {
    message:
      "Evidence must attach to exactly one target (timelineEntryId | caseTaskId | verificationRecordId | approvalRequestId)",
  });

////////////////////////////////////////////////////////////////
// Commit Schema
////////////////////////////////////////////////////////////////

export const CommitEvidenceSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid(), // ✅ Required for tenant + case validation during commit

    ...PolymorphicTargetFields,
    kind: z.nativeEnum(EvidenceKind),

    // Audit Metadata
    title: z.string().max(255).optional(),
    originalFilename: z.string().min(1).max(255),
    description: z.string().max(1000).optional(),
    uploadedById: z.string().uuid().optional(),

    // File Data
    storageKey: z.string().min(1).max(1000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    mimeType: z.string().max(255).optional(),
    byteSize: z.number().int().positive().optional(),
  })
  .refine(enforceExactlyOneTarget, {
    message:
      "Evidence must attach to exactly one target (timelineEntryId | caseTaskId | verificationRecordId | approvalRequestId)",
  });

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// - Central XOR logic ensures future target types require only extending
//   PolymorphicTargetFields.
// - Shared validation prevents service/schema drift.
// - Case-aware commit enables strict multi-tenant + workflow isolation.
// - Safe foundation for adding presigned GET retrieval validation later.
////////////////////////////////////////////////////////////////
