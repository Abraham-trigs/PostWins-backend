// filepath: src/modules/routing/postwin-offline.service.ts

/**
 * ⚠️ PHASE 2 ONLY
 * -------------------------------------------------------------------
 * Offline transport and replay service.
 *
 * This service may invoke orchestration pipelines that:
 * - advance routing
 * - trigger verification
 * - append ledger entries
 *
 * It MUST NOT be used as evidence of Phase 1.5 invariants.
 */

import { PostWin, ExecutionBody } from "@posta/core";
import { PostWinPipelineService } from "./postwin-pipeline.service";
// NOTE:
// Phase 2 transport + replay service.
// Does not itself infer or mutate state,
// but delegates to orchestration pipelines that may.

// Simple offline queue
interface OfflineQueueItem {
  postWin: PostWin;
  availableBodies: ExecutionBody[];
}

export class PostWinOfflineService {
  private queue: OfflineQueueItem[] = [];
  private pipeline: PostWinPipelineService;

  constructor(pipeline: PostWinPipelineService) {
    this.pipeline = pipeline;
    this.startBackgroundSync();
  }

  /**
   * Accept PostWin intake even when offline
   */
  async enqueuePostWin(postWin: PostWin, availableBodies: ExecutionBody[]) {
    this.queue.push({ postWin, availableBodies });
    console.log(`PostWin queued for beneficiary ${postWin.beneficiaryId}`);
  }

  /**
   * Background synchronization loop
   */
  private startBackgroundSync() {
    setInterval(async () => {
      if (this.queue.length === 0) return;

      const itemsToSync = [...this.queue];
      this.queue = [];

      for (const item of itemsToSync) {
        try {
          // Phase 2: delegated orchestration (may advance routing & verification)
          const processed = await this.pipeline.intakeAndRoute(
            item.postWin.description ?? "",
            item.postWin.beneficiaryId ?? "",
            item.availableBodies,
            item.postWin.authorId,
          );
          console.log(
            `Synced PostWin for beneficiary ${processed.beneficiaryId}`,
          );
        } catch (err) {
          console.error(
            `Failed to sync PostWin for ${item.postWin.beneficiaryId}`,
            err,
          );
          // Requeue for next sync attempt
          this.queue.push(item);
        }
      }
    }, 5000); // every 5 seconds; configurable
  }
}
