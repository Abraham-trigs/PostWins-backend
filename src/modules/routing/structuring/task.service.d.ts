import { Journey, PostWin } from "@posta/core";
export declare class TaskService {
    private projectTasks;
    /**
     * Validates that the attempted task can be performed based on journey dependencies
     */
    validateTaskSequence(journey: Journey, attemptedTaskId: string): boolean;
    /**
     * Processes an intake message, optionally from a partner, into a Partial<PostWin>
     */
    processIntake(message: string, partnerId?: string): Promise<Partial<PostWin>>;
    /**
     * Simulates context detection; in production, replace with NLP/AI service
     */
    private detectContext;
    /**
     * Sanitizes description text to neutral form
     */
    private sanitizeDescription;
}
//# sourceMappingURL=task.service.d.ts.map