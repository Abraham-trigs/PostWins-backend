// src/modules/cases/tags/tag.service.ts
// Global Tag registry (platform-level vocabulary)

import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CreateTagSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
});

const DeleteTagSchema = z.object({
  key: z.string().min(1),
});

export class TagService {
  ////////////////////////////////////////////////////////////////
  // Create global tag (idempotent)
  ////////////////////////////////////////////////////////////////

  async create(input: unknown) {
    const { key, label } = CreateTagSchema.parse(input);

    return prisma.tag.upsert({
      where: { key },
      update: { label },
      create: {
        key,
        label,
      },
    });
  }

  ////////////////////////////////////////////////////////////////
  // Delete global tag (cascades to CaseTag)
  ////////////////////////////////////////////////////////////////

  async delete(input: unknown) {
    const { key } = DeleteTagSchema.parse(input);

    await prisma.tag.delete({
      where: { key },
    });

    return { ok: true };
  }

  ////////////////////////////////////////////////////////////////
  // List all global tags
  ////////////////////////////////////////////////////////////////

  async list() {
    return prisma.tag.findMany({
      orderBy: { key: "asc" },
    });
  }
}
