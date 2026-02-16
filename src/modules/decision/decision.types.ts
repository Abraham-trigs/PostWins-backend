// apps/backend/src/modules/decision/decision.types.ts
// Purpose: Canonical decision input + explanation contracts aligned strictly with Prisma schema.

import { ActorKind, DecisionType } from "@prisma/client";
import { z } from "zod";

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
  })
  .superRefine((data, ctx) => {
    // Enforce HUMAN must provide actorUserId
    if (data.actorKind === ActorKind.HUMAN && !data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "actorUserId is required when actorKind is HUMAN",
      });
    }

    // SYSTEM must NOT provide actorUserId
    if (data.actorKind === ActorKind.SYSTEM && data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "actorUserId must not be provided for SYSTEM actor",
      });
    }
  });

////////////////////////////////////////////////////////////////
// Input Type (Derived from Schema)
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
  intentContext?: Record<string, unknown>;
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

////////////////////////////////////////////////////////////////
// Example Usage
////////////////////////////////////////////////////////////////

/*
const params = normalizeApplyDecisionInput({
  tenantId: "uuid",
  caseId: "uuid",
  decisionType: DecisionType.ROUTING,
  actorKind: ActorKind.SYSTEM,
});

DecisionService.apply(params);
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// This file enforces that all write-side decision operations derive directly
// from Prisma enums and are validated at the boundary. Actor authority is
// explicit and cannot drift. No runtime inference allowed.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod schema is canonical contract
// - Type inferred from schema
// - DTO separated from write model
// - Normalizer provides consistent error shape
// - Authority helper included

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Always call normalizeApplyDecisionInput before writing to DB.
// Never construct ApplyDecisionParams manually.
// Never allow services to accept raw unknown input.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// When Phase 2 introduces additional DecisionType values (e.g. GRANT,
// TRANCHE), this file remains stable because it binds to Prisma enums.
// Authority logic scales without branching explosion.
