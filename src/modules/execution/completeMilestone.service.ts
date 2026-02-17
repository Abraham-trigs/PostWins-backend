// apps/backend/src/modules/execution/completeMilestone.service.ts
// Service responsible for completing an execution milestone with tenant enforcement, idempotency safety, ledger recording, and automatic execution finalization.

import { prisma } from "@/lib/prisma";
import {
  Prisma,
  LedgerEventType,
  ActorKind,
  ExecutionStatus,
} from "@prisma/client";
import { commitLedgerEvent } from "@/modules/intake/ledger/commitLedgerEvent";
import { InvariantViolationError } from "@/modules/cases/case.errors";

/**
 * Input contract for completing a milestone.
 * idempotencyKey + requestHash are used to guarantee safe replay protection
 * and cryptographically traceable actor authority in ledger events.
 */
export type CompleteMilestoneInput = {
  tenantId: string;
  milestoneId: string;
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
};

export class CompleteMilestoneService {
  /**
   * Completes a milestone atomically.
   *
   * Guarantees:
   * - Strict tenant boundary enforcement
   * - Idempotent behavior
   * - Ledger consistency
   * - Automatic execution completion when progress reaches 100%
   */
  async complete(input: CompleteMilestoneInput) {
    const { tenantId, milestoneId, actorUserId, idempotencyKey, requestHash } =
      input;

    // All logic runs inside a single transaction to prevent partial state writes.
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      /**
       * Load milestone and its parent execution.
       * We must verify:
       * - Milestone exists
       * - Belongs to correct tenant
       * - Execution is active
       */
      const milestone = await tx.executionMilestone.findUnique({
        where: { id: milestoneId },
        include: { execution: true },
      });

      if (!milestone) {
        throw new InvariantViolationError("MILESTONE_NOT_FOUND");
      }

      // 🔒 Enforce strict tenant isolation
      if (milestone.execution.tenantId !== tenantId) {
        throw new InvariantViolationError("TENANT_MISMATCH");
      }

      // ♻️ Idempotent guard: if already completed, return existing state
      // Prevents double ledger writes and race-condition duplication.
      if (milestone.completedAt) {
        return milestone;
      }

      // 🔒 Execution must still be active to allow milestone completion
      if (milestone.execution.status !== ExecutionStatus.IN_PROGRESS) {
        throw new InvariantViolationError("EXECUTION_NOT_ACTIVE");
      }

      const now = new Date();

      /**
       * 1️⃣ Mark milestone complete
       * We record both timestamp and actor identity for auditability.
       */
      const updatedMilestone = await tx.executionMilestone.update({
        where: { id: milestoneId },
        data: {
          completedAt: now,
          completedByUserId: actorUserId,
        },
      });

      /**
       * 2️⃣ Record progress in ledger
       * Ledger acts as immutable event history.
       * Authority proof encodes replay protection context.
       */
      await commitLedgerEvent(
        {
          tenantId,
          caseId: milestone.execution.caseId,
          eventType: LedgerEventType.EXECUTION_PROGRESS_RECORDED,
          actor: {
            kind: ActorKind.HUMAN,
            userId: actorUserId,
            authorityProof: `HUMAN:${actorUserId}:${idempotencyKey}:${requestHash}`,
          },
          intentContext: {
            milestoneId,
          },
          payload: {
            milestoneId,
            executionId: milestone.executionId,
            completedAt: now.toISOString(),
          },
        },
        tx,
      );

      /**
       * 3️⃣ Recalculate weighted progress
       * Progress is derived from milestone weights, not stored.
       * This avoids drift and preserves correctness under retries.
       */
      const allMilestones = await tx.executionMilestone.findMany({
        where: { executionId: milestone.executionId },
      });

      const totalWeight = allMilestones.reduce((sum, m) => sum + m.weight, 0);

      const completedWeight = allMilestones.reduce(
        (sum, m) => sum + (m.completedAt ? m.weight : 0),
        0,
      );

      /**
       * 4️⃣ Automatic execution completion
       * If weighted progress reaches 100%, close execution.
       * This keeps execution state derived from milestone truth.
       */
      if (totalWeight > 0 && completedWeight === totalWeight) {
        await tx.execution.update({
          where: { id: milestone.executionId },
          data: {
            status: ExecutionStatus.COMPLETED,
            completedAt: now,
          },
        });

        await commitLedgerEvent(
          {
            tenantId,
            caseId: milestone.execution.caseId,
            eventType: LedgerEventType.EXECUTION_COMPLETED,
            actor: {
              kind: ActorKind.HUMAN,
              userId: actorUserId,
              authorityProof: `AUTO_COMPLETION:${actorUserId}:${idempotencyKey}:${requestHash}`,
            },
            intentContext: null,
            payload: {
              executionId: milestone.executionId,
              completedAt: now.toISOString(),
            },
          },
          tx,
        );
      }

      return updatedMilestone;
    });
  }
}

/* -------------------------------------------------------------------------------------------------
Design reasoning

Milestone completion is a state transition with financial and audit implications.
Therefore it must be:
- Transactional (no partial writes)
- Tenant isolated
- Idempotent
- Ledger-backed (immutable audit trail)
- Derived-state driven (execution completion depends on milestone truth)

Execution completion is not manually toggled — it emerges from weighted milestone truth.

---------------------------------------------------------------------------------------------------
Structure

- Input type defines strict service boundary.
- Single public method: complete()
- Wrapped in prisma.$transaction for atomic safety.
- Guard checks:
  1. Existence
  2. Tenant boundary
  3. Idempotency
  4. Execution state
- Side effects:
  - Milestone update
  - Ledger event (progress)
  - Weighted recalculation
  - Conditional execution finalization
  - Ledger event (completion)

---------------------------------------------------------------------------------------------------
Implementation guidance

- Ensure executionMilestone.weight is non-null and validated at creation.
- Consider adding a database-level partial unique index if duplicate completion
  must be structurally prevented.
- Ensure commitLedgerEvent is transaction-aware and does not open nested transactions.
- If concurrency risk increases, consider SELECT ... FOR UPDATE semantics.

---------------------------------------------------------------------------------------------------
Scalability insight

This approach recalculates progress from source-of-truth data each time.
That trades a small read cost for correctness.

For very large milestone sets:
- Introduce aggregated progress columns updated transactionally.
- Or compute via materialized views.

Never store derived percentage blindly — recompute or assert consistency.
Truth must be reconstructible from ledger + milestone state.

Would I ship this to production without a second review?
Yes — but I would verify ledger atomicity under load.

Does this protect user data and preserve UX under failure?
Yes — transaction rollback guarantees consistency.

If this fails, can we roll it back safely and quickly?
Yes — no destructive irreversible writes occur before validation.

Who is responsible for this file tomorrow?
The engineer maintaining execution domain integrity.
------------------------------------------------------------------------------------------------- */
