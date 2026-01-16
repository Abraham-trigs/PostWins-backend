"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostWinOfflineService = void 0;
class PostWinOfflineService {
    queue = [];
    pipeline;
    constructor(pipeline) {
        this.pipeline = pipeline;
        this.startBackgroundSync();
    }
    /**
     * Accept PostWin intake even when offline
     */
    async enqueuePostWin(postWin, availableBodies) {
        this.queue.push({ postWin, availableBodies });
        console.log(`PostWin queued for beneficiary ${postWin.beneficiaryId}`);
    }
    /**
     * Background synchronization loop
     */
    startBackgroundSync() {
        setInterval(async () => {
            if (this.queue.length === 0)
                return;
            const itemsToSync = [...this.queue];
            this.queue = [];
            for (const item of itemsToSync) {
                try {
                    const processed = await this.pipeline.intakeAndRoute(item.postWin.description, item.postWin.beneficiaryId, item.availableBodies, item.postWin.authorId);
                    console.log(`Synced PostWin for beneficiary ${processed.beneficiaryId}`);
                }
                catch (err) {
                    console.error(`Failed to sync PostWin for ${item.postWin.beneficiaryId}`, err);
                    // Requeue for next sync attempt
                    this.queue.push(item);
                }
            }
        }, 5000); // every 5 seconds; configurable
    }
}
exports.PostWinOfflineService = PostWinOfflineService;
