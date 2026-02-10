import { prisma } from "../../lib/prisma";
import { CaseLifecycle } from "@prisma/client";
import { deriveCaseStatus } from "./deriveCaseStatus";
import { transitionCaseLifecycle as applyLifecycleRules } from "./transitionCaseLifecycle.domain";

/**
 * NOTE:
 * Case.lifecycle is AUTHORITATIVE state.
 *
 * - Use this helper for internal / non-decision transitions.
 * - If a transition represents a human or system decision,
 *   use transitionCaseLifecycleWithLedger instead.
 *
 * This function is an APPLICATION-LAYER orchestrator:
 * - validates lifecycle transitions via the domain
 * - persists the result
 */

/**
 * Transition a case between lifecycle states.
 *
 * ⚠️ Lifecycle is AUTHORITATIVE.
 * Status is derived and advisory.
 */
export async function transitionCaseLifecycle(params: {
  caseId: string;
  from: CaseLifecycle;
  to: CaseLifecycle;
  actorUserId?: string;
}) {
  const { caseId, from, to } = params;

  // 1. Apply pure domain rules (may throw domain errors)
  const nextLifecycle = applyLifecycleRules({
    caseId,
    current: from,
    target: to,
  });

  // 2. Persist authoritative lifecycle + derived status
  return prisma.case.update({
    where: { id: caseId },
    data: {
      lifecycle: nextLifecycle,
      status: deriveCaseStatus(nextLifecycle),
    },
  });
}
