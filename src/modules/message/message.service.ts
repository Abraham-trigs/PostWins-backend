// src/modules/message/message.service.ts
// Purpose: Threaded, navigation-aware, tenant-safe message service (deterministic).

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Messages are workflow-layer artifacts.
// They must be:
// - Tenant isolated
// - Case validated
// - Author validated
// - Thread-safe
// - Deterministically correlated via clientMutationId
//
// This enables:
// - Optimistic UI reconciliation
// - Exactly-once UI semantics
// - WebSocket + REST convergence
// - No heuristic matching

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - NavigationContextSchema
// - CreateMessageSchema (with clientMutationId)
// - createMessage()
// - getMessagesByCase()

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Storing clientMutationId allows:
// - deterministic optimistic reconciliation
// - offline queue replay
// - idempotent message creation
// - exactly-once UI semantics

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { MessageType, Prisma } from "@prisma/client";
import { assertUuid } from "@/utils/uuid";

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

  // ⚡ Deterministic optimistic correlation token
  clientMutationId: z.string().uuid().optional(),
});

export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class MessageService {
  ////////////////////////////////////////////////////////////////
  // Create Message
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
      // Validate Case (Tenant Isolation)
      ////////////////////////////////////////////////////////////////

      const existingCase = await tx.case.findFirst({
        where: { id: caseId, tenantId },
        select: { id: true },
      });

      if (!existingCase) {
        throw new Error("CASE_NOT_FOUND");
      }

      ////////////////////////////////////////////////////////////////
      // Validate Author (Tenant Isolation)
      ////////////////////////////////////////////////////////////////

      const authorExists = await tx.user.findFirst({
        where: { id: authorId, tenantId },
        select: { id: true },
      });

      if (!authorExists) {
        throw new Error("AUTHOR_NOT_IN_TENANT");
      }

      ////////////////////////////////////////////////////////////////
      // Validate Parent Message (Thread Safety)
      ////////////////////////////////////////////////////////////////

      if (parentId) {
        const parentMessage = await tx.message.findFirst({
          where: {
            id: parentId,
            caseId,
            tenantId,
          },
          select: { id: true },
        });

        if (!parentMessage) {
          throw new Error("PARENT_MESSAGE_NOT_FOUND");
        }
      }

      ////////////////////////////////////////////////////////////////
      // Create Message (Deterministic + Stateless)
      ////////////////////////////////////////////////////////////////

      return tx.message.create({
        data: {
          tenantId,
          caseId,
          authorId,
          parentId: parentId ?? null,
          type,
          body,

          // ⚡ Persist mutation token for UI reconciliation
          clientMutationId: clientMutationId ?? null,

          // SQL NULL semantics for JSON
          navigationContext:
            (navigationContext as Prisma.InputJsonValue) ?? null,
        },
      });
    });
  }

  ////////////////////////////////////////////////////////////////
  // Fetch Messages By Case
  ////////////////////////////////////////////////////////////////

  async getMessagesByCase(tenantId: string, caseId: string) {
    assertUuid(tenantId, "tenantId");
    assertUuid(caseId, "caseId");

    return prisma.message.findMany({
      where: { tenantId, caseId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            replies: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
