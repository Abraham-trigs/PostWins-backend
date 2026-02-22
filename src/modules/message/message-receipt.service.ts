// apps/backend/src/modules/message/message-receipt.service.ts
// Purpose: Deterministic delivery + seen tracking with monotonic transitions.

import { prisma } from "@/lib/prisma";

export class MessageReceiptService {
  async markDelivered(tenantId: string, messageId: string, userId: string) {
    return prisma.messageReceipt.upsert({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
      update: {
        deliveredAt: new Date(),
      },
      create: {
        tenantId,
        messageId,
        userId,
        deliveredAt: new Date(),
      },
    });
  }

  async markSeen(tenantId: string, messageId: string, userId: string) {
    return prisma.messageReceipt.upsert({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
      update: {
        seenAt: new Date(),
      },
      create: {
        tenantId,
        messageId,
        userId,
        seenAt: new Date(),
      },
    });
  }
}
