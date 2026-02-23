// apps/backend/src/modules/message/read-position.service.ts
// Purpose: Maintain per-user per-case cursor-based read position.

import { prisma } from "@/lib/prisma";

export class ReadPositionService {
  async updatePosition(
    tenantId: string,
    caseId: string,
    userId: string,
    messageId: string,
  ) {
    // Validate message belongs to tenant + case
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        caseId,
        tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!message) {
      throw new Error("INVALID_MESSAGE_FOR_CASE");
    }

    return prisma.caseReadPosition.upsert({
      where: {
        caseId_userId: {
          caseId,
          userId,
        },
      },
      update: {
        lastReadMessageId: message.id,
        lastReadAt: new Date(),
      },
      create: {
        tenantId,
        caseId,
        userId,
        lastReadMessageId: message.id,
        lastReadAt: new Date(),
      },
    });
  }
}
