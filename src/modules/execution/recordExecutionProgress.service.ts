// filepath: apps/backend/src/modules/execution/recordExecutionProgress.service.ts
// Purpose: Record non-authoritative execution progress events with strict JSON normalization
// and Prisma-safe typing. Prevents unsafe Prisma.InputJsonValue casts.

////////////////////////////////////////////////////////////////
// Assumptions
////////////////////////////////////////////////////////////////
// - Prisma schema contains Execution and ExecutionProgress models
// - ExecutionProgress.detail is stored as a JSON column
// - Execution must exist before recording progress
// - Progress records are informational and not authoritative governance events

////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////

import { prisma } from "@/lib/prisma";
import { InvariantViolationError } from "@/modules/cases/case.errors";
import { Prisma } from "@prisma/client";
import { ExecutionProgressLabel } from "./executionProgress.labels";

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

type RecordExecutionProgressInput = {
  tenantId: string;
  caseId: string;

  label: ExecutionProgressLabel;

  /**
   * Arbitrary progress metadata from execution engine
   * Must be JSON-serializable
   */
  detail?: Record<string, unknown>;

  actorUserId?: string;
};

////////////////////////////////////////////////////////////////
// Helper: Safe JSON normalization
////////////////////////////////////////////////////////////////

/**
 * Ensures the object is JSON serializable before sending to Prisma.
 * Prevents runtime failures from Date, BigInt, Map, functions, etc.
 */
function normalizeJson(
  input: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!input) return undefined;

  try {
    return JSON.parse(JSON.stringify(input));
  } catch {
    throw new Error("Execution progress detail must be JSON serializable");
  }
}

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export async function recordExecutionProgress(
  input: RecordExecutionProgressInput,
) {
  const { caseId, label, detail } = input;

  return prisma.$transaction(async (tx) => {
    ////////////////////////////////////////////////////////////////
    // 1️⃣ Execution must exist
    ////////////////////////////////////////////////////////////////

    const execution = await tx.execution.findUnique({
      where: { caseId },
      select: { id: true },
    });

    if (!execution) {
      throw new InvariantViolationError(
        "EXECUTION_PROGRESS_REQUIRES_EXECUTION",
      );
    }

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Record progress (non-authoritative informational event)
    ////////////////////////////////////////////////////////////////

    const progress = await tx.executionProgress.create({
      data: {
        executionId: execution.id,

        // enum-safe label
        label,

        // normalized JSON (replaces unsafe `as Prisma.InputJsonValue`)
        detail: normalizeJson(detail),
      },
    });

    return progress;
  });
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Execution progress events are informational telemetry describing
// the progress of case execution. They are not authoritative ledger
// events and therefore do not require governance envelopes.
//
// JSON normalization ensures Prisma JSON columns cannot receive
// non-serializable objects that would cause runtime errors or drift.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - RecordExecutionProgressInput: input contract
// - normalizeJson(): JSON safety boundary
// - recordExecutionProgress(): transactional persistence

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Call this service from execution orchestration layers:
//
// await recordExecutionProgress({
//   tenantId,
//   caseId,
//   label: "MILESTONE_COMPLETED",
//   detail: { milestoneId },
//   actorUserId,
// });

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// By normalizing JSON here we protect the entire execution pipeline.
// Future telemetry (metrics, structured events, observability hooks)
// can reuse this boundary without introducing unsafe Prisma casts.
////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
// Example usage
////////////////////////////////////////////////////////////////
/*
await recordExecutionProgress({
  tenantId,
  caseId,
  label: "EVIDENCE_RECEIVED",
  detail: { evidenceId: "abc123" },
});
*/
