// apps/backend/src/modules/cases/transitionCaseLifecycle.ts
// Purpose: Canonical pure lifecycle transition function derived from Prisma CaseLifecycle enum.

import { CaseLifecycle } from "@prisma/client";
import { CASE_LIFECYCLE_TRANSITIONS } from "./caseLifecycle.transitions";
import { IllegalLifecycleTransitionError } from "./case.errors";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation Schema
////////////////////////////////////////////////////////////////

const TransitionInputSchema = z.object({
  caseId: z.string().uuid(),
  current: z.nativeEnum(CaseLifecycle),
  target: z.nativeEnum(CaseLifecycle),
});

export type TransitionInput = z.infer<typeof TransitionInputSchema>;

////////////////////////////////////////////////////////////////
// Pure Transition Function
////////////////////////////////////////////////////////////////

/**
 * Pure lifecycle transition function.
 *
 * LAW:
 * - Deterministic
 * - Side-effect free
 * - Throws on illegal transitions
 * - Must derive from Prisma enum
 */
export function transitionCaseLifecycle(input: unknown): CaseLifecycle {
  const parsed = TransitionInputSchema.safeParse(input);

  if (!parsed.success) {
    throw {
      error: parsed.error.flatten().fieldErrors,
    };
  }

  const { caseId, current, target } = parsed.data;

  const allowed = CASE_LIFECYCLE_TRANSITIONS[current] ?? [];

  if (!allowed.includes(target)) {
    throw new IllegalLifecycleTransitionError(current, target, caseId);
  }

  return target;
}

////////////////////////////////////////////////////////////////
// Example Usage
////////////////////////////////////////////////////////////////

/*
const next = transitionCaseLifecycle({
  caseId: "uuid",
  current: CaseLifecycle.INTAKE,
  target: CaseLifecycle.ROUTED,
});
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Lifecycle is authoritative and schema-governed. By binding directly
// to Prisma's CaseLifecycle enum, we prevent runtime/schema drift.
// Validation occurs at boundary. The function remains pure and
// deterministic.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Zod validation boundary
// - Prisma enum authority
// - Pure transition logic
// - Centralized transition table
// - Explicit illegal transition error

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Never mutate lifecycle directly in services.
// Always call this function before DB writes.
// transitionCaseLifecycleWithLedger must wrap this,
// never bypass it.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// When Phase 2 introduces additional lifecycle states (e.g. EXECUTION),
// only Prisma schema and transition table change.
// This function remains stable and drift-resistant.
