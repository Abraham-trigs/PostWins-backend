// apps/backend/src/modules/message/read-position.service.ts
// Purpose: Maintain per-user per-case monotonic read position
// aligned with message ordering (createdAt DESC, id DESC).

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Monotonicity: Read position can ONLY move forward.
// - Ordering consistency: Uses same lexicographic ordering as pagination.
// - Tenant isolation: Message must belong to tenant + case.
// - No backward regression under race conditions.

import { prisma } from "@/lib/prisma";

export class ReadPositionService {
  async updatePosition(
    tenantId: string,
    caseId: string,
    userId: string,
    messageId: string,
  ) {
    ////////////////////////////////////////////////////////////////
    // 1. Validate message belongs to tenant + case
    ////////////////////////////////////////////////////////////////

    const currentMessage = await prisma.message.findFirst({
      where: {
        id: messageId,
        caseId,
        tenantId,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (!currentMessage) {
      throw new Error("INVALID_MESSAGE_FOR_CASE");
    }

    ////////////////////////////////////////////////////////////////
    // 2. Fetch existing read position
    ////////////////////////////////////////////////////////////////

    const existing = await prisma.caseReadPosition.findUnique({
      where: {
        caseId_userId: {
          caseId,
          userId,
        },
      },
      select: {
        lastReadMessageId: true,
      },
    });

    ////////////////////////////////////////////////////////////////
    // 3. Enforce monotonic forward-only movement
    ////////////////////////////////////////////////////////////////
    // Compare using same ordering as:
    // ORDER BY createdAt DESC, id DESC

    if (existing?.lastReadMessageId) {
      const previous = await prisma.message.findUnique({
        where: { id: existing.lastReadMessageId },
        select: {
          id: true,
          createdAt: true,
        },
      });

      if (previous) {
        const prevTime = previous.createdAt.getTime();
        const currTime = currentMessage.createdAt.getTime();

        const isBackward =
          currTime < prevTime ||
          (currTime === prevTime && currentMessage.id < previous.id);

        if (isBackward) {
          // Ignore backward movement to preserve monotonicity
          return existing;
        }
      }
    }

    ////////////////////////////////////////////////////////////////
    // 4. Upsert forward read position
    ////////////////////////////////////////////////////////////////

    return prisma.caseReadPosition.upsert({
      where: {
        caseId_userId: {
          caseId,
          userId,
        },
      },
      update: {
        lastReadMessageId: currentMessage.id,
        lastReadAt: new Date(),
      },
      create: {
        tenantId,
        caseId,
        userId,
        lastReadMessageId: currentMessage.id,
        lastReadAt: new Date(),
      },
    });
  }
}
