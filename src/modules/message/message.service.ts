// apps/backend/src/modules/message/message.service.ts

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { MessageType, Prisma } from "@prisma/client";
import { assertUuid } from "@/utils/uuid";
import { decodeCursor, encodeCursor } from "./cursor";

////////////////////////////////////////////////////////////////
// Validation Schemas
////////////////////////////////////////////////////////////////

export const NavigationContextSchema = z.object({
  target: z.enum(["TASK", "MESSAGE", "EXTERNAL"]),
  id: z.string().min(1),
  params: z
    .object({
      highlight: z.boolean().optional(),
      focus: z.boolean().optional(),
      mode: z.enum(["peek", "full"]).optional(),
    })
    .optional(),
  label: z.string().optional(),
});

export const CreateMessageSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  authorId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  type: z.nativeEnum(MessageType),
  body: z.string().trim().min(1).max(5000),
  navigationContext: NavigationContextSchema.optional(),
  clientMutationId: z.string().uuid().optional(),
});

export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class MessageService {
  ////////////////////////////////////////////////////////////////
  // Create Message (Idempotent + Race Safe)
  ////////////////////////////////////////////////////////////////

  async createMessage(input: unknown) {
    const parsed = CreateMessageSchema.parse(input);

    const {
      tenantId,
      caseId,
      authorId,
      parentId,
      type,
      body,
      navigationContext,
      clientMutationId,
    } = parsed;

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      ////////////////////////////////////////////////////////////////
      // Idempotency pre-check
      ////////////////////////////////////////////////////////////////

      if (clientMutationId) {
        const existing = await tx.message.findFirst({
          where: { tenantId, clientMutationId },
        });

        if (existing) return existing;
      }

      ////////////////////////////////////////////////////////////////
      // Isolation checks
      ////////////////////////////////////////////////////////////////

      const existingCase = await tx.case.findFirst({
        where: { id: caseId, tenantId },
        select: { id: true },
      });

      if (!existingCase) throw new Error("CASE_NOT_FOUND");

      const authorExists = await tx.user.findFirst({
        where: { id: authorId, tenantId },
        select: { id: true },
      });

      if (!authorExists) throw new Error("AUTHOR_NOT_IN_TENANT");

      if (parentId) {
        const parentMessage = await tx.message.findFirst({
          where: { id: parentId, caseId, tenantId },
          select: { id: true },
        });

        if (!parentMessage) throw new Error("PARENT_MESSAGE_NOT_FOUND");
      }

      ////////////////////////////////////////////////////////////////
      // Create (race-safe)
      ////////////////////////////////////////////////////////////////

      try {
        return await tx.message.create({
          data: {
            tenantId,
            caseId,
            authorId,
            parentId: parentId ?? null,
            type,
            body,
            clientMutationId: clientMutationId ?? null,
            navigationContext:
              (navigationContext as Prisma.InputJsonValue) ?? null,
          },
        });
      } catch (err: any) {
        if (clientMutationId && err.code === "P2002") {
          const existing = await tx.message.findFirst({
            where: { tenantId, clientMutationId },
          });

          if (existing) return existing;
        }

        throw err;
      }
    });
  }

  ////////////////////////////////////////////////////////////////
  // Cursor-Based Pagination (limit+1)
  ////////////////////////////////////////////////////////////////

  async getMessagesByCase(
    tenantId: string,
    caseId: string,
    cursor?: string,
    limit: number = 30,
  ) {
    assertUuid(tenantId, "tenantId");
    assertUuid(caseId, "caseId");

    limit = Math.min(Math.max(limit, 1), 100);

    let cursorPayload: { createdAt: Date; id: string } | undefined;

    if (cursor) {
      const decoded = decodeCursor(cursor);

      cursorPayload = {
        createdAt: new Date(decoded.createdAt),
        id: decoded.id,
      };
    }

    const messages = await prisma.message.findMany({
      where: {
        tenantId,
        caseId,
        ...(cursorPayload && {
          OR: [
            { createdAt: { lt: cursorPayload.createdAt } },
            {
              createdAt: cursorPayload.createdAt,
              id: { lt: cursorPayload.id },
            },
          ],
        }),
      },
      include: {
        author: { select: { id: true, name: true } },
        _count: { select: { replies: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = messages.length > limit;

    if (hasMore) messages.pop();

    const nextCursor =
      hasMore && messages.length > 0
        ? encodeCursor({
            createdAt: messages[messages.length - 1].createdAt.toISOString(),
            id: messages[messages.length - 1].id,
          })
        : null;

    return {
      messages: messages.reverse(),
      nextCursor,
      hasMore,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Unread Count (MessageId → createdAt resolution)
  ////////////////////////////////////////////////////////////////

  async getUnreadCount(tenantId: string, caseId: string, userId: string) {
    assertUuid(tenantId, "tenantId");
    assertUuid(caseId, "caseId");
    assertUuid(userId, "userId");

    const position = await prisma.caseReadPosition.findUnique({
      where: { caseId_userId: { caseId, userId } },
      select: { lastReadMessageId: true },
    });

    ////////////////////////////////////////////////////////////////
    // Never read → count all non-authored messages
    ////////////////////////////////////////////////////////////////

    if (!position?.lastReadMessageId) {
      return prisma.message.count({
        where: {
          tenantId,
          caseId,
          authorId: { not: userId },
        },
      });
    }

    ////////////////////////////////////////////////////////////////
    // Resolve timestamp from message
    ////////////////////////////////////////////////////////////////

    const lastRead = await prisma.message.findUnique({
      where: { id: position.lastReadMessageId },
      select: { createdAt: true },
    });

    if (!lastRead) return 0;

    ////////////////////////////////////////////////////////////////
    // Count strictly newer messages
    ////////////////////////////////////////////////////////////////

    return prisma.message.count({
      where: {
        tenantId,
        caseId,
        authorId: { not: userId },
        createdAt: { gt: lastRead.createdAt },
      },
    });
  }
}
