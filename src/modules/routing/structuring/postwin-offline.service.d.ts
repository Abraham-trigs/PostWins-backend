import { PostWin, ExecutionBody } from "@posta/core";
import { PostWinPipelineService } from "./postwin-pipeline.service";
export declare class PostWinOfflineService {
    private queue;
    private pipeline;
    constructor(pipeline: PostWinPipelineService);
    /**
     * Accept PostWin intake even when offline
     */
    enqueuePostWin(postWin: PostWin, availableBodies: ExecutionBody[]): Promise<void>;
    /**
     * Background synchronization loop
     */
    private startBackgroundSync;
}
//# sourceMappingURL=postwin-offline.service.d.ts.map