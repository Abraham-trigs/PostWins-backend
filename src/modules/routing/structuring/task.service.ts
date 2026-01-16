// filepath: apps/backend/src/modules/routing/task.service.ts
// Purpose: Handles task sequence validation and intake processing for PostWins.

import { Task, Journey, PostWin } from "@posta/core";

export class TaskService {
  // Mock task list; in prod, fetch from database
  private projectTasks: Task[] = [
    { id: 't1', order: 1, label: 'Enrolment', requiredForSdg: 'SDG_4', dependencies: [] },
    { id: 't2', order: 2, label: 'Literacy Module', requiredForSdg: 'SDG_4', dependencies: ['t1'] }
  ];

  /**
   * Validates that the attempted task can be performed based on journey dependencies
   */
  validateTaskSequence(journey: Journey, attemptedTaskId: string): boolean {
    const task = this.projectTasks.find(t => t.id === attemptedTaskId);
    if (!task) return false;

    // All dependencies must be completed first
    return task.dependencies.every(depId => journey.completedTaskIds.includes(depId));
  }

  /**
   * Processes an intake message, optionally from a partner, into a Partial<PostWin>
   */
  async processIntake(message: string, partnerId?: string): Promise<Partial<PostWin>> {
    try {
      const context = await this.detectContext(message);
      const description = this.sanitizeDescription(message);

      return {
        description,
        authorId: partnerId || 'anonymous',
        assignedBodyId: partnerId || undefined,
        routingStatus: partnerId ? 'MATCHED' : 'UNASSIGNED',
        verificationStatus: 'PENDING',
        sdgGoals: context.sdgGoals || ['SDG_4']
      };
    } catch (err: any) {
      console.error("TaskService.processIntake error:", err);
      throw new Error("Failed to process intake message");
    }
  }

  /**
   * Simulates context detection; in production, replace with NLP/AI service
   */
  private async detectContext(message: string): Promise<{ sdgGoals: ('SDG_4' | 'SDG_5')[] }> {
    // Very naive placeholder: assign SDG_4 if 'school' or 'literacy' mentioned
    const lower = message.toLowerCase();
    if (lower.includes('school') || lower.includes('literacy')) return { sdgGoals: ['SDG_4'] };
    return { sdgGoals: ['SDG_5'] };
  }

  /**
   * Sanitizes description text to neutral form
   */
  private sanitizeDescription(message: string): string {
    return message.trim().replace(/\s+/g, ' ');
  }
}

/*
Design reasoning:
- Separates sequence validation and intake processing.
- Self-contained context detection and sanitization allow the service to run independently.
- Partial<PostWin> returned allows downstream services to enrich with IDs, timestamps, or verification steps.

Structure:
- projectTasks defines vertical task flow and dependencies.
- validateTaskSequence ensures tasks are performed in correct order.
- processIntake converts raw messages into a normalized PostWin object.

Implementation guidance:
- Replace in-memory projectTasks with DB fetch for dynamic tasks.
- Replace detectContext with AI/NLP integration for real context detection.
- Add logging/monitoring for production intake pipelines.

Scalability insight:
- Supports multi-role and multi-task intake.
- Can be integrated with JourneyService for sequential enforcement.
- Lightweight, async-safe, easily extended to support new SDGs or task rules.
*/

/* Example usage:
(async () => {
  const taskService = new TaskService();
  const mockJourney: Journey = { id: 'j1', beneficiaryId: 'b1', currentTaskId: 't1', completedTaskIds: [] };

  console.log(taskService.validateTaskSequence(mockJourney, 't2')); // false

  const postWin = await taskService.processIntake("Learner completed literacy module", "ngo_123");
  console.log(postWin);
})();
*/
