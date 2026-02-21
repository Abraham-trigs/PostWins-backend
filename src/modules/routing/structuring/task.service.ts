// filepath: apps/backend/src/modules/routing/task.service.ts
// Purpose: Pure task sequence validation service.
// No intake processing. No governance mutation.

import { Task, Journey } from "@posta/core";

export class TaskService {
  /**
   * In production this should be fetched from DB.
   * Kept in-memory for deterministic sequence validation only.
   */
  private readonly projectTasks: Task[] = [
    {
      id: "t1",
      order: 1,
      label: "Enrolment",
      requiredForSdg: "SDG_4",
      dependencies: [],
    },
    {
      id: "t2",
      order: 2,
      label: "Literacy Module",
      requiredForSdg: "SDG_4",
      dependencies: ["t1"],
    },
  ];

  /**
   * Validates whether a task can be executed
   * based strictly on journey completion state.
   *
   * This method:
   * - Does NOT mutate state
   * - Does NOT infer lifecycle
   * - Does NOT commit ledger
   * - Is purely deterministic
   */
  validateTaskSequence(journey: Journey, attemptedTaskId: string): boolean {
    const task = this.projectTasks.find((t) => t.id === attemptedTaskId);

    if (!task) {
      return false;
    }

    return task.dependencies.every((depId) =>
      journey.completedTaskIds.includes(depId),
    );
  }

  /**
   * Optional: expose read-only task metadata.
   * Does NOT allow mutation.
   */
  getTaskDefinition(taskId: string): Task | undefined {
    return this.projectTasks.find((t) => t.id === taskId);
  }
}
