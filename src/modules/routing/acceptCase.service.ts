// apps/backend/src/modules/routing/acceptCase.service.ts

import { prisma } from "@/lib/prisma";
import { CaseLifecycle } from "../cases/CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { ActorKind } from "@prisma/client";
import { InvariantViolationError } from "../cases/case.errors";

/**
 * Acceptance command.
 *
 * Authority Rules:
 * - HUMAN must belong to assigned execution body.
 * - SYSTEM must explicitly declare authority.
 * - Lifecycle transition commits ledger event exactly once.
 * - Tenant isolation enforced.
 * - Idempotent if already ACCEPTED.
 */
export async function acceptCase(params: {
  tenantId: string;
  caseId: string;
  userId?: string;
  isSystem?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    ////////////////////////////////////////////////////////////////
    // 1️⃣ Ensure case exists + tenant scoped
    ////////////////////////////////////////////////////////////////

    const existingCase = await tx.case.findFirstOrThrow({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
      },
      select: {
        id: true,
        lifecycle: true,
      },
    });

    // Idempotency guard
    if (existingCase.lifecycle === CaseLifecycle.ACCEPTED) {
      return { ok: true };
    }

    // Optional strict lifecycle invariant
    if (existingCase.lifecycle !== CaseLifecycle.ROUTED) {
      throw new InvariantViolationError(
        "CASE_MUST_BE_ROUTED_BEFORE_ACCEPTANCE",
      );
    }

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Load assignment (tenant enforced through case relation)
    ////////////////////////////////////////////////////////////////

    const assignment = await tx.caseAssignment.findFirstOrThrow({
      where: {
        caseId: params.caseId,
        case: { tenantId: params.tenantId },
      },
      select: {
        executionBodyId: true,
      },
    });

    ////////////////////////////////////////////////////////////////
    // 3️⃣ Enforce HUMAN authority
    ////////////////////////////////////////////////////////////////

    if (!params.isSystem) {
      if (!params.userId) {
        throw new InvariantViolationError("HUMAN_ACCEPTANCE_REQUIRES_USER_ID");
      }

      const membership = await tx.executionBodyMember.findFirst({
        where: {
          tenantId: params.tenantId,
          executionBodyId: assignment.executionBodyId,
          userId: params.userId,
        },
        select: { id: true },
      });

      if (!membership) {
        throw new InvariantViolationError("USER_NOT_MEMBER_OF_EXECUTION_BODY");
      }
    }

    ////////////////////////////////////////////////////////////////
    // 4️⃣ Structured actor
    ////////////////////////////////////////////////////////////////

    const actor =
      params.isSystem === true
        ? {
            kind: ActorKind.SYSTEM,
            authorityProof: "SYSTEM_EXECUTION_AUTHORITY",
          }
        : {
            kind: ActorKind.HUMAN,
            userId: params.userId!,
            authorityProof: "EXECUTION_BODY_ACCEPTANCE",
          };

    ////////////////////////////////////////////////////////////////
    // 5️⃣ Single authoritative lifecycle transition
    ////////////////////////////////////////////////////////////////

    await transitionCaseLifecycleWithLedger({
      tenantId: params.tenantId,
      caseId: params.caseId,
      target: CaseLifecycle.ACCEPTED,
      actor,
      intentContext: {
        executionBodyId: assignment.executionBodyId,
      },
    });

    return { ok: true };
  });
}
