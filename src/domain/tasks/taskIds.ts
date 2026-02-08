// packages/core/src/domain/tasks/taskIds.ts

export enum TaskId {
  START = "START",
  ENROLL = "ENROLL",
  ATTEND = "ATTEND",
  MODULE_1 = "MODULE_1",
  MODULE_2 = "MODULE_2",
}

/**
 * Guardrail: only use at system boundaries.
 */
export function assertValidTask(task: string): asserts task is TaskId {
  if (!Object.values(TaskId).includes(task as TaskId)) {
    throw new Error(`Invalid task id: ${task}`);
  }
}
