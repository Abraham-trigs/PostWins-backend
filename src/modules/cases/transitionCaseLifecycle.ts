// apps/backend/src/modules/cases/transitionCaseLifecycle.ts
// Canonical pure lifecycle transition function.

import { CaseLifecycle } from "@prisma/client";
import { CASE_LIFECYCLE_TRANSITIONS } from "./caseLifecycle.transitions";
import { IllegalLifecycleTransitionError } from "./case.errors";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Errors
////////////////////////////////////////////////////////////////

export class LifecycleValidationError extends Error {
  public readonly details: Record<string, string[] | undefined>;
  constructor(details: Record<string, string[] | undefined>) {
    super("Invalid lifecycle transition input");
    this.name = "LifecycleValidationError";
    this.details = details;
  }
}

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

export function transitionCaseLifecycle(input: unknown): CaseLifecycle {
  const parsed = TransitionInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new LifecycleValidationError(parsed.error.flatten().fieldErrors);
  }

  const { caseId, current, target } = parsed.data;

  const allowed = CASE_LIFECYCLE_TRANSITIONS[current] ?? [];

  if (!allowed.includes(target)) {
    throw new IllegalLifecycleTransitionError(current, target, caseId);
  }

  return target;
}
