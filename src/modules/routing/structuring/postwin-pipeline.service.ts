// filepath: apps/backend/src/modules/routing/postwin-pipeline.service.ts
// Purpose: Intake → routing → verification pipeline

/**
 * ⚠️ PHASE 2–AWARE SERVICE
 * -------------------------------------------------------------------
 * This pipeline is Phase 1.5–safe *by default*,
 * but exposes Phase 2 hooks for:
 * - verification mutation
 * - orchestration replay
 *
 * Only `intakeAndRoute` is Phase 1.5–compliant.
 */

//
// Phase 1.5 INVARIANT(intakeRouite only):
// - TaskService is injected but NOT USED
// - No task inference, sequencing, or defaults beyond TaskId.START
// - Tasks are identifiers only

import { PostWin, ExecutionBody } from "@posta/core";
import { TaskService } from "./task.service"; // Phase 2 (intentionally dormant)
import { JourneyService } from "../journey/journey.service";
import { PostWinRoutingService } from "./postwin-routing.service";
import { TaskId } from "../../../domain/tasks/taskIds";
import { assertValidTask } from "@/domain/tasks/assertValidTask";

export class PostWinPipelineService {
  constructor(
    private taskService: TaskService, // kept for Phase 2
    private journeyService: JourneyService,
    private routingService: PostWinRoutingService,
  ) {}

  /**
   * Complete intake → routing → verification pipeline
   * Phase 1.5: task-agnostic
   */
  async intakeAndRoute(
    message: string,
    beneficiaryId: string,
    availableBodies: ExecutionBody[],
    partnerId?: string,
  ): Promise<PostWin> {
    /**
     * STEP 1: Minimal intake normalization
     * (No task inference, no classification)
     */
    const partialPostWin: Partial<PostWin> = {
      description: message.trim(),
      beneficiaryId,
      authorId: partnerId,
      taskId: TaskId.START, // canonical, deterministic
    };

    assertValidTask(partialPostWin.taskId);

    /**
     * STEP 2: Routing (task-agnostic)
     * TaskService intentionally NOT invoked in Phase 1.5
     */
    const fullPostWin = await this.routingService.processPostWin(
      partialPostWin as PostWin,
      availableBodies,
    );

    return fullPostWin;
  }

  /**
   * Adds a verifier approval to a PostWin
   */
  /**
   * Phase 2 ONLY
   * -------------------------------------------------------------------
   * Direct verification mutation.
   * Bypasses ledger-backed verification invariants.
   */

  addVerification(postWin: PostWin, verifierId: string, sdgGoal: string) {
    this.routingService.addVerifierApproval(postWin, verifierId, sdgGoal);
  }
}
