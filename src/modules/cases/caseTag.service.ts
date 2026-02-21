// src/modules/cases/tags/caseTag.service.ts
// Case ↔ Global Tag association service

import { prisma } from "@/lib/prisma";
import { z } from "zod";

const AttachTagSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  tagKey: z.string().min(1),
});

const DetachTagSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  tagKey: z.string().min(1),
});

export class CaseTagService {
  ////////////////////////////////////////////////////////////////
  // Attach tag to case (idempotent)
  ////////////////////////////////////////////////////////////////

  async attach(input: unknown) {
    const { tenantId, caseId, tagKey } = AttachTagSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Ensure case exists within tenant
      ////////////////////////////////////////////////////////////////

      await tx.case.findFirstOrThrow({
        where: {
          id: caseId,
          tenantId,
        },
        select: { id: true },
      });

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Resolve global tag
      ////////////////////////////////////////////////////////////////

      const tag = await tx.tag.findUnique({
        where: { key: tagKey },
        select: { id: true },
      });

      if (!tag) {
        throw new Error("GLOBAL_TAG_NOT_FOUND");
      }

      ////////////////////////////////////////////////////////////////
      // 3️⃣ Attach via CaseTag join
      ////////////////////////////////////////////////////////////////

      await tx.caseTag.upsert({
        where: {
          caseId_tagId: {
            caseId,
            tagId: tag.id,
          },
        },
        update: {},
        create: {
          caseId,
          tagId: tag.id,
        },
      });

      return { ok: true };
    });
  }

  ////////////////////////////////////////////////////////////////
  // Detach tag from case
  ////////////////////////////////////////////////////////////////

  async detach(input: unknown) {
    const { tenantId, caseId, tagKey } = DetachTagSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      ////////////////////////////////////////////////////////////////
      // 1️⃣ Ensure case belongs to tenant
      ////////////////////////////////////////////////////////////////

      await tx.case.findFirstOrThrow({
        where: {
          id: caseId,
          tenantId,
        },
        select: { id: true },
      });

      ////////////////////////////////////////////////////////////////
      // 2️⃣ Resolve tag
      ////////////////////////////////////////////////////////////////

      const tag = await tx.tag.findUnique({
        where: { key: tagKey },
        select: { id: true },
      });

      if (!tag) {
        throw new Error("GLOBAL_TAG_NOT_FOUND");
      }

      ////////////////////////////////////////////////////////////////
      // 3️⃣ Remove association
      ////////////////////////////////////////////////////////////////

      await tx.caseTag.deleteMany({
        where: {
          caseId,
          tagId: tag.id,
        },
      });

      return { ok: true };
    });
  }

  ////////////////////////////////////////////////////////////////
  // List tags attached to case
  ////////////////////////////////////////////////////////////////

  async list(params: { tenantId: string; caseId: string }) {
    const { tenantId, caseId } = params;

    return prisma.caseTag.findMany({
      where: {
        case: {
          id: caseId,
          tenantId,
        },
      },
      include: {
        tag: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
