import { Journey, PostWin, ExecutionBody } from "@posta/core";
export declare class JourneyService {
    private educationPath;
    private journeys;
    getOrCreateJourney(beneficiaryId: string): Journey;
    /**
     * Section E: Vertical Journey Sequence Validation
     * Replaces 'canAdvance' to sync with IntakeController.validateTaskSequence
     */
    validateTaskSequence(journey: Journey, taskCode: string): boolean;
    /**
     * Section K: Post-Response Completion
     */
    completeTask(beneficiaryId: string, taskId: string): void;
    /**
     * Section J: Geographical & Trust-Based Routing
     */
    routePostWin(postWin: PostWin, availableBodies: ExecutionBody[]): Promise<string>;
    private isBodyCapable;
    private calculateProximity;
}
//# sourceMappingURL=journey.service.d.ts.map