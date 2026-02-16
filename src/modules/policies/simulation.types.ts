// apps/backend/src/modules/policy/policy-simulation.types.ts
// Purpose: Deterministic policy simulation contract aligned with canonical lifecycle + routing schema.

import { RoutingOutcome, TaskId } from "@prisma/client";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Canonical Effect Enum (Runtime Safe)
////////////////////////////////////////////////////////////////

export const PolicyEffectKindSchema = z.enum([
  "ADVANCE_TASK",
  "ROUTE",
  "NO_OP",
]);

export type PolicyEffectKind = z.infer<typeof PolicyEffectKindSchema>;

////////////////////////////////////////////////////////////////
// Input Validation
////////////////////////////////////////////////////////////////

export const PolicySimulationInputSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),

  hypotheticalFacts: z.object({
    routingOutcome: z.nativeEnum(RoutingOutcome).optional(),
    deliveryRecorded: z.boolean().optional(),
    followupRecorded: z.boolean().optional(),
    currentTask: z.nativeEnum(TaskId).optional(),
  }),
});

export type PolicySimulationInput = z.infer<typeof PolicySimulationInputSchema>;

////////////////////////////////////////////////////////////////
// Result Validation
////////////////////////////////////////////////////////////////

export const PolicySimulationResultSchema = z.object({
  policyKey: z.string().min(1),
  version: z.string().min(1),

  wouldApply: z.boolean(),

  effect: z
    .object({
      kind: PolicyEffectKindSchema,
      details: z.record(z.unknown()),
    })
    .optional(),

  reason: z.string().min(1),
});

export type PolicySimulationResult = z.infer<
  typeof PolicySimulationResultSchema
>;

////////////////////////////////////////////////////////////////
// Normalizers
////////////////////////////////////////////////////////////////

export function normalizePolicySimulationInput(
  input: unknown,
): PolicySimulationInput {
  const parsed = PolicySimulationInputSchema.safeParse(input);

  if (!parsed.success) {
    throw {
      error: parsed.error.flatten().fieldErrors,
    };
  }

  return parsed.data;
}

export function normalizePolicySimulationResult(
  input: unknown,
): PolicySimulationResult {
  const parsed = PolicySimulationResultSchema.safeParse(input);

  if (!parsed.success) {
    throw {
      error: parsed.error.flatten().fieldErrors,
    };
  }

  return parsed.data;
}

////////////////////////////////////////////////////////////////
// Example Usage
////////////////////////////////////////////////////////////////

/*
const input = normalizePolicySimulationInput({
  tenantId: "uuid",
  caseId: "uuid",
  hypotheticalFacts: {
    routingOutcome: RoutingOutcome.MATCHED,
    currentTask: TaskId.START,
  },
});

const result: PolicySimulationResult = {
  policyKey: "ROUTE_TO_DELIVERY",
  version: "1.0.0",
  wouldApply: true,
  effect: {
    kind: "ADVANCE_TASK",
    details: { nextTask: TaskId.ENROLL },
  },
  reason: "Routing matched and task progression allowed",
};
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Policy simulation must never rely on vague booleans. Routing authority
// derives from canonical RoutingOutcome. Task transitions derive from
// TaskId enum. Validation prevents drift between schema and runtime.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod schema defines boundary contract
// - Types inferred from schema
// - Canonical enums imported from Prisma
// - Deterministic effect kind enum
// - Explicit normalizers for safe boundary usage

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Never accept raw input in policy simulation services.
// Always normalize input before evaluation.
// Never infer routing from boolean flags.
// Always use RoutingOutcome.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// As Phase 2 introduces funding policy and tranche logic, additional
// effect kinds can be appended safely to PolicyEffectKindSchema without
// breaking existing runtime consumers. Schema remains authoritative.
