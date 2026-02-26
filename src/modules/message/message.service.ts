// apps/backend/src/modules/message/message.service.ts

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { MessageType, Prisma } from "@prisma/client";
import { assertUuid } from "@/utils/uuid";
import { decodeCursor, encodeCursor } from "./cursor";

////////////////////////////////////////////////////////////////
// Validation Schemas  findMany
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

////////////////////////////////////////////////////////////////
// Evidence Attachment Schema (Atomic Support)
////////////////////////////////////////////////////////////////

const EvidenceAttachmentSchema = z.object({
  kind: z.enum(["image", "video", "document", "audio"]),
  storageKey: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  mimeType: z.string().optional(),
  byteSize: z.number().int().positive().optional(),
});

////////////////////////////////////////////////////////////////
// Create Message Schema (Updated)
////////////////////////////////////////////////////////////////

export const CreateMessageSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid(),
    authorId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    type: z.nativeEnum(MessageType),

    body: z.string().trim().max(5000).optional(),

    navigationContext: NavigationContextSchema.optional(),
    clientMutationId: z.string().uuid().optional(),

    evidence: z.array(EvidenceAttachmentSchema).optional(),
  })
  .refine(
    (data) => {
      const hasBody = !!data.body && data.body.trim().length > 0;
      const hasEvidence = !!data.evidence && data.evidence.length > 0;
      return hasBody || hasEvidence;
    },
    { message: "Message must contain body or evidence" },
  );

export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class MessageService {
  ////////////////////////////////////////////////////////////////
  // Create Message (Idempotent + Race Safe + Atomic Evidence)
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
      evidence,
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
      // Create message
      ////////////////////////////////////////////////////////////////

      const createdMessage = await tx.message.create({
        data: {
          tenantId,
          caseId,
          authorId,
          parentId: parentId ?? null,
          type,
          body: body ?? null,
          clientMutationId: clientMutationId ?? null,
          navigationContext:
            (navigationContext as Prisma.InputJsonValue) ?? null,
        },
      });

      ////////////////////////////////////////////////////////////////
      // Atomic Evidence Attachment
      ////////////////////////////////////////////////////////////////

      if (evidence && evidence.length > 0) {
        await tx.evidence.createMany({
          data: evidence.map((e) => ({
            tenantId,
            timelineEntryId: createdMessage.id,
            kind: e.kind as any,
            storageKey: e.storageKey,
            sha256: e.sha256,
            mimeType: e.mimeType ?? null,
            byteSize: e.byteSize ?? null,
          })),
        });
      }

      return createdMessage;
    });
  }

  ////////////////////////////////////////////////////////////////
  // Cursor-Based Pagination (unchanged)
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

        evidence: {
          select: {
            id: true,
            kind: true,
            storageKey: true,
            sha256: true,
            mimeType: true,
            byteSize: true,
            createdAt: true,
          },
        },

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
  // Unread Count (unchanged)
  ////////////////////////////////////////////////////////////////

  async getUnreadCount(tenantId: string, caseId: string, userId: string) {
    assertUuid(tenantId, "tenantId");
    assertUuid(caseId, "caseId");
    assertUuid(userId, "userId");

    const position = await prisma.caseReadPosition.findUnique({
      where: { caseId_userId: { caseId, userId } },
      select: { lastReadMessageId: true },
    });

    if (!position?.lastReadMessageId) {
      return prisma.message.count({
        where: {
          tenantId,
          caseId,
          authorId: { not: userId },
        },
      });
    }

    const lastRead = await prisma.message.findUnique({
      where: { id: position.lastReadMessageId },
      select: { createdAt: true },
    });

    if (!lastRead) return 0;

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
