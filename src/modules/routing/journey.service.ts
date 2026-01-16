// filepath: apps/backend/src/modules/routing/journey.service.ts
import { Task, Journey, PostWin, ExecutionBody, KHALISTAR_ID } from "@posta/core";

export class JourneyService {
  private educationPath: Task[] = [
    { id: 'ENROLL', order: 1, label: 'School Enrollment', requiredForSdg: 'SDG_4', dependencies: [] },
    { id: 'ATTEND', order: 2, label: 'Consistent Attendance', requiredForSdg: 'SDG_4', dependencies: ['ENROLL'] },
    { id: 'MODULE_1', order: 3, label: 'Basic Literacy', requiredForSdg: 'SDG_4', dependencies: ['ATTEND'] }
  ];

  private journeys = new Map<string, Journey>();

  public getOrCreateJourney(beneficiaryId: string): Journey {
    if (!this.journeys.has(beneficiaryId)) {
      this.journeys.set(beneficiaryId, {
        id: 'journey_' + beneficiaryId,
        beneficiaryId,
        currentTaskId: this.educationPath[0].id,
        completedTaskIds: []
      });
    }
    return this.journeys.get(beneficiaryId)!;
  }

  /**
   * Section E: Vertical Journey Sequence Validation
   * Replaces 'canAdvance' to sync with IntakeController.validateTaskSequence
   */
  public validateTaskSequence(journey: Journey, taskCode: string): boolean {
    const task = this.educationPath.find(t => t.id === taskCode);
    
    // If task is not in path, it violates SDG governance
    if (!task) return false;

    // Requirement E.2: Check if all prerequisites are in completedTaskIds
    for (const depId of task.dependencies) {
      if (!journey.completedTaskIds.includes(depId)) {
        return false; // Dependency missing
      }
    }

    return true;
  }

  /**
   * Section K: Post-Response Completion
   */
  public completeTask(beneficiaryId: string, taskId: string): void {
    const journey = this.getOrCreateJourney(beneficiaryId);
    
    if (!journey.completedTaskIds.includes(taskId)) {
      journey.completedTaskIds.push(taskId);
      
      // Advance currentTaskId to the next logical step in the educationPath
      const currentTask = this.educationPath.find(t => t.id === taskId);
      const nextTask = this.educationPath.find(t => t.order === (currentTask?.order || 0) + 1);
      
      if (nextTask) {
        journey.currentTaskId = nextTask.id;
      }
    }
  }

  /**
   * Section J: Geographical & Trust-Based Routing
   */
  public async routePostWin(postWin: PostWin, availableBodies: ExecutionBody[]): Promise<string> {
    // 1. Author's Choice (Requirement 2)
    if (postWin.preferredBodyId) {
      const preferred = availableBodies.find(b => b.id === postWin.preferredBodyId);
      if (preferred && this.isBodyCapable(preferred, postWin)) return preferred.id;
    }

    // 2. Filter by SDG Capability
    const matches = availableBodies.filter(body =>
      postWin.sdgGoals.every(goal => body.capabilities.includes(goal))
    );

    if (matches.length === 0) return KHALISTAR_ID;

    // 3. Section J.3: Proximity & Trust Score (Requirement 0.7 threshold)
    const bestMatch = matches
      .sort((a, b) => this.calculateProximity(a, postWin) - this.calculateProximity(b, postWin))
      .find(body => (body.trustScore || 0) >= 0.7);

    return bestMatch ? bestMatch.id : KHALISTAR_ID;
  }

  private isBodyCapable(body: ExecutionBody, postWin: PostWin): boolean {
    return postWin.sdgGoals.every(goal => body.capabilities.includes(goal));
  }

  private calculateProximity(body: ExecutionBody, postWin: PostWin): number {
    if (!postWin.location) return Infinity;
    // Euclidean distance for coordinate-based routing
    return Math.sqrt(
      Math.pow(body.location.lat - postWin.location.lat, 2) +
      Math.pow(body.location.lng - postWin.location.lng, 2)
    );
  }
}
