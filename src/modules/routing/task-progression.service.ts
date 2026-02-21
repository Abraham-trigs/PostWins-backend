// apps/backend/src/modules/routing/task-progression.service.ts

import { TaskId } from "@prisma/client";

export type TaskEvent =
  | "ENROLL"
  | "ATTEND"
  | "COMPLETE_MODULE_1"
  | "COMPLETE_MODULE_2";

/**
 * Deterministic transition table.
 *
 * Structure:
 * currentTask -> event -> nextTask
 *
 * Adding a new task requires editing this table only.
 */
const TRANSITIONS: Record<TaskId, Partial<Record<TaskEvent, TaskId>>> = {
  [TaskId.START]: {
    ENROLL: TaskId.ENROLL,
  },

  [TaskId.ENROLL]: {
    ATTEND: TaskId.ATTEND,
  },

  [TaskId.ATTEND]: {
    COMPLETE_MODULE_1: TaskId.MODULE_1,
  },

  [TaskId.MODULE_1]: {
    COMPLETE_MODULE_2: TaskId.MODULE_2,
  },

  [TaskId.MODULE_2]: {}, // terminal
};

export class TaskProgressionService {
  /**
   * Canonical task transition resolver.
   *
   * - Deterministic
   * - Stateless
   * - Throws on invalid transition
   */
  public getNextTask(current: TaskId, event: TaskEvent): TaskId {
    const next = TRANSITIONS[current]?.[event];

    if (!next) {
      throw new Error(`Invalid task transition: ${current} -> ${event}`);
    }

    return next;
  }

  /**
   * Optional helper for introspection (useful for UI)
   */
  public getAvailableEvents(current: TaskId): TaskEvent[] {
    return Object.keys(TRANSITIONS[current] ?? {}) as TaskEvent[];
  }

  /**
   * Optional terminal check
   */
  public isTerminal(task: TaskId): boolean {
    return Object.keys(TRANSITIONS[task] ?? {}).length === 0;
  }
}
