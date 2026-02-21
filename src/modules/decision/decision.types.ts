// apps/backend/src/modules/decision/decision.types.ts
// Purpose: Canonical decision input + explanation contracts aligned strictly with Prisma schema.

import { ActorKind, DecisionType } from "@prisma/client";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Decision Effect Schema (Authoritative Effect Contract)
////////////////////////////////////////////////////////////////

export const DecisionEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("EXECUTION_VERIFIED"),
  }),
]);

export type DecisionEffect = z.infer<typeof DecisionEffectSchema>;

////////////////////////////////////////////////////////////////
// Validation Schema
////////////////////////////////////////////////////////////////

export const ApplyDecisionSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid(),

    decisionType: z.nativeEnum(DecisionType),
    actorKind: z.nativeEnum(ActorKind),

    actorUserId: z.string().uuid().optional(),

    reason: z.string().trim().min(1).optional(),
    intentContext: z.record(z.unknown()).optional(),

    supersedesDecisionId: z.string().uuid().optional(),

    // 🔑 Required authoritative effect
    effect: DecisionEffectSchema,
  })
  .superRefine((data, ctx) => {
    if (data.actorKind === ActorKind.HUMAN && !data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "actorUserId is required when actorKind is HUMAN",
      });
    }

    if (data.actorKind === ActorKind.SYSTEM && data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "actorUserId must not be provided for SYSTEM actor",
      });
    }
  });

////////////////////////////////////////////////////////////////
// Input Type
////////////////////////////////////////////////////////////////

export type ApplyDecisionParams = z.infer<typeof ApplyDecisionSchema>;

////////////////////////////////////////////////////////////////
// Read Model (DTO Only)
////////////////////////////////////////////////////////////////

export interface DecisionExplanation {
  decisionId: string;
  decisionType: DecisionType;

  authoritative: boolean;
  supersededAt?: Date;

  actorKind: ActorKind;
  actorUserId?: string;

  decidedAt: Date;
  reason?: string;

  intentContext?: unknown;
}

////////////////////////////////////////////////////////////////
// Normalizer
////////////////////////////////////////////////////////////////

export function normalizeApplyDecisionInput(
  input: unknown,
): ApplyDecisionParams {
  const parsed = ApplyDecisionSchema.safeParse(input);

  if (!parsed.success) {
    throw {
      error: parsed.error.flatten().fieldErrors,
    };
  }

  return parsed.data;
}

////////////////////////////////////////////////////////////////
// Helper
////////////////////////////////////////////////////////////////

export function isAuthoritativeDecision(supersededAt: Date | null): boolean {
  return supersededAt === null;
}
