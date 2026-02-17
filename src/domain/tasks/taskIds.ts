// filepath: apps/backend/src/domain/tasks/taskIds.ts
// Purpose: Canonical TaskId typing + runtime validation aligned with Prisma enum

import { TaskId as PrismaTaskId } from "@prisma/client";

/**
 * TaskId
 * ------
 * Canonical type derived from Prisma enum.
 * Single source of truth is Prisma schema.
 */
export type TaskId = PrismaTaskId;

/**
 * Runtime guard — use at system boundaries.
 *
 * Accepts unknown to allow:
 * - HTTP payload validation
 * - Queue message validation
 * - Defensive domain assertions
 *
 * Safe to call even if already strongly typed.
 */
export function assertValidTask(task: unknown): asserts task is TaskId {
  if (typeof task !== "string") {
    throw new Error("TaskId must be a string");
  }

  if (!Object.values(PrismaTaskId).includes(task as PrismaTaskId)) {
    throw new Error(`Invalid task id: ${task}`);
  }
}
