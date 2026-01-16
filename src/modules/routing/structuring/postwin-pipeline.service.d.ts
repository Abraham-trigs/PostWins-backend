import { PostWin, ExecutionBody } from "@posta/core";
import { TaskService } from "./task.service";
import { JourneyService } from "./journey.service";
import { PostWinRoutingService } from "./postwin-routing.service";
export declare class PostWinPipelineService {
    private taskService;
    private journeyService;
    private routingService;
    constructor(taskService: TaskService, journeyService: JourneyService, routingService: PostWinRoutingService);
    /**
     * Complete intake → routing → verification pipeline
     * Includes fraud/integrity hooks
     */
    intakeAndRoute(message: string, beneficiaryId: string, availableBodies: ExecutionBody[], partnerId?: string): Promise<PostWin>;
    /**
     * Adds a verifier approval to a PostWin
     */
    addVerification(postWin: PostWin, verifierId: string, sdgGoal: string): void;
}
//# sourceMappingURL=postwin-pipeline.service.d.ts.map