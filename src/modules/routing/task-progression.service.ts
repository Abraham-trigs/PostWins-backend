// apps/backend/src/modules/routing/task-progression.service.ts
import { TaskId } from "../../domain/tasks/taskIds";

export type TaskEvent =
  | "ENROLL"
  | "ATTEND"
  | "COMPLETE_MODULE_1"
  | "COMPLETE_MODULE_2";

export class TaskProgressionService {
  /**
   * Canonical task transition resolver.
   * Throws if transition is invalid.
   */
  public getNextTask(current: TaskId, event: TaskEvent): TaskId {
    switch (current) {
      case TaskId.START:
        if (event === "ENROLL") return TaskId.ENROLL;
        break;

      case TaskId.ENROLL:
        if (event === "ATTEND") return TaskId.ATTEND;
        break;

      case TaskId.ATTEND:
        if (event === "COMPLETE_MODULE_1") return TaskId.MODULE_1;
        break;

      case TaskId.MODULE_1:
        if (event === "COMPLETE_MODULE_2") return TaskId.MODULE_2;
        break;
    }

    throw new Error(`Invalid task transition: ${current} -> ${event}`);
  }
}
