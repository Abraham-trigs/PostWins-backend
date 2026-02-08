import { prisma } from "../../lib/prisma";
import { CaseLifecycle } from "@prisma/client";
import { deriveCaseStatus } from "./deriveCaseStatus";
import { CASE_LIFECYCLE_TRANSITIONS } from "./caseLifecycle.transitions";

/**
 * Transition a case between lifecycle states.
 *
 * ⚠️ Lifecycle is AUTHORITATIVE.
 * Status is derived and advisory.
 *
 * This function centralizes lifecycle mutation.
 */
export async function transitionCaseLifecycle(params: {
  caseId: string;
  from: CaseLifecycle;
  to: CaseLifecycle;
  actorUserId?: string;
}) {
  const { caseId, from, to } = params;

  const allowedNext = CASE_LIFECYCLE_TRANSITIONS[from] ?? [];

  if (!allowedNext.includes(to)) {
    console.warn(
      "[domain-warning] Invalid CaseLifecycle transition attempted",
      { caseId, from, to },
    );
  }

  return prisma.case.update({
    where: { id: caseId },
    data: {
      lifecycle: to,
      status: deriveCaseStatus(to),
    },
  });
}
