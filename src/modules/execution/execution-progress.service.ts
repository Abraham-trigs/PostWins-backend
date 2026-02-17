// apps/backend/src/modules/execution/executionProgress.service.ts
// Service responsible for deriving execution progress deterministically from milestone state with strict tenant enforcement.

import { prisma } from "@/lib/prisma";
import { ExecutionStatus } from "@prisma/client";
import { InvariantViolationError } from "@/modules/cases/case.errors";

/**
 * Read-model returned to consumers.
 * This is a derived projection — no values here are stored directly. derivedStatus
 */
export type ExecutionProgressView = {
  executionId: string;
  caseId: string;
  totalWeight: number;
  completedWeight: number;
  percent: number;
  derivedStatus: ExecutionStatus;
  milestones: {
    id: string;
    label: string;
    weight: number;
    completed: boolean;
    completedAt: Date | null;
  }[];
};

export class ExecutionProgressService {
  /**
   * Returns a deterministic progress view for a given case execution.
   *
   * Guarantees:
   * - Tenant boundary enforcement
   * - Derived progress calculation (never trusting stored percent)
   * - Stable read model safe for UI consumption
   */
  async getProgress(
    tenantId: string,
    caseId: string,
  ): Promise<ExecutionProgressView> {
    /**
     * We assume caseId is unique per execution.
     * If not enforced in schema, add unique constraint.
     */
    const execution = await prisma.execution.findUnique({
      where: { caseId },
      include: {
        milestones: true,
      },
    });

    if (!execution) {
      throw new InvariantViolationError("EXECUTION_NOT_FOUND");
    }

    // 🔒 Strict tenant boundary enforcement
    if (execution.tenantId !== tenantId) {
      throw new InvariantViolationError("TENANT_MISMATCH");
    }

    /**
     * Calculate total weighted capacity.
     * We do not trust any stored aggregate.
     */
    const totalWeight = execution.milestones.reduce(
      (sum, milestone) => sum + milestone.weight,
      0,
    );

    /**
     * Calculate completed weighted progress.
     * Completion is derived strictly from completedAt presence.
     */
    const completedWeight = execution.milestones
      .filter((milestone) => milestone.completedAt !== null)
      .reduce((sum, milestone) => sum + milestone.weight, 0);

    /**
     * Percent is derived, rounded for UI stability.
     * Avoid floating drift across clients.
     */
    const percent =
      totalWeight === 0 ? 0 : Math.round((completedWeight / totalWeight) * 100);

    /**
     * Derived status is computed, not trusted.
     * Execution status column should match this logically,
     * but UI depends on computed truth.
     */
    let derivedStatus: ExecutionStatus = ExecutionStatus.IN_PROGRESS;

    if (percent === 100 && totalWeight > 0) {
      derivedStatus = ExecutionStatus.COMPLETED;
    }

    return {
      executionId: execution.id,
      caseId: execution.caseId,
      totalWeight,
      completedWeight,
      percent,
      derivedStatus,
      milestones: execution.milestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.label,
        weight: milestone.weight,
        completed: milestone.completedAt !== null,
        completedAt: milestone.completedAt,
      })),
    };
  }
}

/* -------------------------------------------------------------------------------------------------
Design reasoning

Progress is a derived projection, not stored state.
Storing percentages introduces drift, concurrency bugs, and reconciliation cost.

This service reconstructs truth from milestones every time.
That guarantees correctness even under retries, race conditions, or partial updates.

Tenant enforcement is mandatory before returning any derived data.

---------------------------------------------------------------------------------------------------
Structure

- ExecutionProgressView: stable read-model for UI.
- Single public method: getProgress()
- Guard checks:
  1. Execution exists
  2. Tenant boundary enforcement
- Derived computations:
  - totalWeight
  - completedWeight
  - percent (rounded)
  - derivedStatus
- Milestones mapped into a safe presentation format.

---------------------------------------------------------------------------------------------------
Implementation guidance

- Ensure execution.caseId has a unique constraint in Prisma schema.
- Ensure milestone.weight is validated at creation (non-negative).
- Consider indexing execution(caseId, tenantId) for faster lookups.
- If milestone count grows significantly, evaluate aggregation queries.

---------------------------------------------------------------------------------------------------
Scalability insight

For large milestone sets:
- Replace in-memory reduce() with aggregate queries:
  prisma.executionMilestone.aggregate(...)
- Or introduce materialized views if progress becomes hot-path.

Never persist percent unless:
1. It is treated as a cache.
2. It is recalculated transactionally.
3. Drift detection exists.

Would I ship this to production without a second review?
Yes — assuming schema constraints enforce uniqueness and weight integrity.

Does this protect user data and preserve UX under failure?
Yes — derived state ensures consistency even after partial failures.

If this fails, can we roll it back safely and quickly?
Yes — no writes occur here. Pure read model.

Who is responsible for this file tomorrow?
The engineer safeguarding execution integrity and progress correctness.
------------------------------------------------------------------------------------------------- */
