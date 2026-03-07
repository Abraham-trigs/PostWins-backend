// apps/backend/src/modules/intake/ledger/ledger.schema.ts
// Purpose: Zod runtime validation schema for ledger commits.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
Ledger commits must be strictly validated before any write.
Centralizing schema logic allows controllers, services, and tests
to share the same validation layer.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- LedgerCommitSchema
*/

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import { z } from "zod";
import { Prisma, LedgerEventType, ActorKind } from "@prisma/client";

const JsonValueSchema: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const LedgerCommitSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid().nullable().optional(),
    eventType: z.nativeEnum(LedgerEventType),
    actorKind: z.nativeEnum(ActorKind),
    actorUserId: z.string().uuid().nullable().optional(),
    authorityProof: z.string().min(1),
    intentContext: JsonValueSchema.optional(),
    payload: JsonValueSchema.optional(),
    supersedesCommitId: z.string().uuid().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.actorKind === ActorKind.HUMAN && !data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "actorUserId required for HUMAN actor",
      });
    }

    if (data.actorKind === ActorKind.SYSTEM && data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "SYSTEM actor must not include userId",
      });
    }
  });

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Used inside LedgerService.commit() before any database write.
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
Future ledger event schemas (e.g., domain-specific payload validation)
can extend this schema through discriminated unions.
*/
