// apps/backend/src/modules/routing/acceptCase.service.ts
// Accepts a case and transitions lifecycle to ACCEPTED.
// Commits canonical ledger event inside the same transaction.

import { prisma } from "@/lib/prisma";
import { CaseLifecycle } from "../cases/CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";
import { LedgerEventType, ActorKind } from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";

/**
 * Acceptance command.
 *
 * 🧠 Key:
 * - Ownership becomes explicit here.
 * - Humans and systems share the same path.
 * - No special-casing beyond actor.kind.
 */
export async function acceptCase(params: {
  tenantId: string;
  caseId: string;
  userId?: string;
  isSystem?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.caseAssignment.findUniqueOrThrow({
      where: { caseId: params.caseId },
    });

    // 🔒 Membership check MUST exist (execution body membership)
    // Do not commit without this guard

    const actor = {
      kind: params.isSystem ? ActorKind.SYSTEM : ActorKind.HUMAN,
      userId: params.userId,
      authorityProof: params.isSystem
        ? "KHALISTAR_EXECUTION_AUTHORITY"
        : "EXECUTION_BODY_ACCEPTANCE",
    } as const;

    await transitionCaseLifecycleWithLedger({
      tenantId: params.tenantId,
      caseId: params.caseId,
      target: CaseLifecycle.ACCEPTED,
      actor,
    });

    await commitLedgerEvent(
      {
        tenantId: params.tenantId,
        caseId: params.caseId,
        eventType: LedgerEventType.CASE_ACCEPTED,
        actor,
        payload: {
          executionBodyId: assignment.executionBodyId,
        },
      },
      tx,
    );
  });
}

/* ================================================================
   Design reasoning
   ================================================================ */
// Acceptance establishes explicit ownership.
// Lifecycle transition and ledger causality are atomic.
// Actor structure is standardized across domains.

///////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////
// - Transaction boundary
// - Assignment resolution
// - Structured actor creation
// - Lifecycle transition
// - Canonical ledger commit

///////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////
// - Enforce execution body membership before accepting.
// - Keep lifecycle transition + ledger commit atomic.
// - Never bypass structured actor contract.
// - Do not commit ledger outside transaction.

///////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////
// Atomic transition prevents split-brain lifecycle states.
// Canonical ledger entry ensures audit consistency.
// Structured actor allows uniform authorization modeling across system + human paths.
///////////////////////////////////////////////////////////////////
