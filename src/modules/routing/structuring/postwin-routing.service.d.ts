import { EventEmitter } from "events";
import { PostWin, ExecutionBody } from "@posta/core";
import { TaskService } from "./task.service";
import { JourneyService } from "../journey.service";
import { LedgerService } from "../../intake/ledger.service";
interface IntegrityFlag {
    type: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    message?: string;
}
export declare class PostWinRoutingService extends EventEmitter {
    private taskService;
    private journeyService;
    private ledgerService;
    private readonly MAX_RETRIES;
    private readonly BASE_DELAY_MS;
    constructor(taskService: TaskService, journeyService: JourneyService, ledgerService: LedgerService);
    /**
     * Internal helper to handle event emission with Exponential Backoff retries.
     * Routes to "ROUTING_DLQ" on final failure.
     */
    private emitWithRetry;
    /**
     * Core orchestration entrypoint for PostWin routing
     */
    processPostWin(postWin: PostWin, availableBodies: ExecutionBody[], sdgGoals?: string[]): Promise<PostWin>;
    /**
     * Adds a verifier approval and checks consensus threshold
     */
    addVerifierApproval(postWin: PostWin, verifierId: string, sdgGoal: string): Promise<void>;
    private shouldEscalate;
    finalizeRouting(postWin: PostWin, flags: IntegrityFlag[]): Promise<void>;
}
export {};
//# sourceMappingURL=postwin-routing.service.d.ts.map