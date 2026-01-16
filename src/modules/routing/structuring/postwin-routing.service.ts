// apps/backend/src/modules/routing/postwin-routing.service.ts
// Purpose: Validates PostWin task integrity, hydrates state, routes to bodies, and manages reliable event delivery with retries.

import { EventEmitter } from "events";
import { PostWin, ExecutionBody, Journey, VerificationRecord } from "@posta/core";
import { TaskService } from "./task.service";
import { JourneyService } from "../journey.service";
import { LedgerService } from "../../intake/ledger.service";

interface IntegrityFlag {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  message?: string;
}

export class PostWinRoutingService extends EventEmitter {
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY_MS = 500;

  constructor(
    private taskService: TaskService,
    private journeyService: JourneyService,
    private ledgerService: LedgerService
  ) {
    super();
  }

  /**
   * Internal helper to handle event emission with Exponential Backoff retries.
   * Routes to "ROUTING_DLQ" on final failure.
   */
  private async emitWithRetry(eventName: string, payload: any, attempt: number = 0): Promise<void> {
    try {
      this.emit(eventName, payload);
    } catch (error) {
      if (attempt < this.MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * this.BASE_DELAY_MS;
        console.warn(`[PostWinRouting] Retry ${attempt + 1} for ${eventName} in ${delay}ms...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.emitWithRetry(eventName, payload, attempt + 1);
      }

      // Final failure: Route to Dead Letter Queue for manual intervention
      this.emit("ROUTING_DLQ", {
        originalEvent: eventName,
        payload,
        error: error instanceof Error ? error.message : "Downstream Listener Failure",
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Core orchestration entrypoint for PostWin routing
   */
  async processPostWin(
    postWin: PostWin,
    availableBodies: ExecutionBody[],
    sdgGoals: string[] = ["SDG_4"]
  ): Promise<PostWin> {
    /**
     * STEP 1: Ensure journey exists
     */
    const journey: Journey = this.journeyService.getOrCreateJourney(postWin.beneficiaryId);

    /**
     * STEP 2: Validate task sequence integrity
     */
    for (const sdg of sdgGoals) {
      const taskValid = this.taskService.validateTaskSequence(journey, postWin.taskId);

      if (!taskValid) {
        postWin.routingStatus = "BLOCKED";
        postWin.verificationStatus = "PENDING";
        postWin.notes = `Cannot perform task ${postWin.taskId} before completing dependencies for ${sdg}`;
        return postWin;
      }
    }

    /**
     * STEP 3: Map Verification Records
     */
    const verificationRecords: VerificationRecord[] = sdgGoals.map(
      (goal): VerificationRecord => ({
        sdgGoal: goal,
        requiredVerifiers: 2,
        receivedVerifications: [],
        consensusReached: false,
        timestamps: { routedAt: new Date().toISOString() }
      })
    );

    /**
     * STEP 4: Mark task completed and Route
     */
    this.journeyService.completeTask(postWin.beneficiaryId, postWin.taskId);
    
    const assignedBodyId = await this.journeyService.routePostWin(postWin, availableBodies);

    /**
     * STEP 5: MUTATE AND HYDRATE
     * Explicitly attaching data to the postWin reference BEFORE emission.
     */
    const finalAssignedBody = assignedBodyId || 'Khalistar_Foundation';

    postWin.verificationRecords = verificationRecords;
    postWin.assignedBodyId = finalAssignedBody;
    postWin.routingStatus = assignedBodyId ? 'MATCHED' : 'FALLBACK';
    postWin.verificationStatus = 'PENDING';
    
    postWin.auditTrail = [
      ...(postWin.auditTrail || []),
      {
        action: 'ROUTED',
        actor: 'Posta-AI',
        assignedBodyId: finalAssignedBody,
        timestamp: new Date().toISOString(),
        note: `Task validated and routed to ${finalAssignedBody}`
      }
    ];

    /**
     * STEP 6: RELIABLE EMISSION
     */
    await this.emitWithRetry("ROUTING_COMPLETE", { 
      postWinId: postWin.id, 
      postWin 
    });

    return postWin;
  }

  /**
   * Adds a verifier approval and checks consensus threshold
   */
  async addVerifierApproval(postWin: PostWin, verifierId: string, sdgGoal: string) {
    const record = postWin.verificationRecords?.find(r => r.sdgGoal === sdgGoal);

    if (!record) {
      throw new Error(`No verification record found for SDG goal ${sdgGoal}.`);
    }

    if (!record.receivedVerifications.includes(verifierId)) {
      record.receivedVerifications.push(verifierId);
    }

    if (record.receivedVerifications.length >= record.requiredVerifiers) {
      record.consensusReached = true;
      postWin.verificationStatus = "VERIFIED";

      postWin.auditTrail = postWin.auditTrail || [];
      postWin.auditTrail.push({
        action: "VERIFIED",
        actor: verifierId,
        timestamp: new Date().toISOString(),
        note: `Consensus reached for ${sdgGoal}`
      });

      await this.emitWithRetry("VERIFICATION_CONSENSUS", { postWinId: postWin.id, postWin });
    }
  }

  private shouldEscalate(postWin: PostWin, flags: IntegrityFlag[]): boolean {
    const hasHighSeverityFlag = flags.some(f => f.severity === "HIGH");
    const isLowConfidence = (postWin.localization?.confidence ?? 1) < 0.7;
    return hasHighSeverityFlag || isLowConfidence;
  }

  async finalizeRouting(postWin: PostWin, flags: IntegrityFlag[]) {
    if (!this.shouldEscalate(postWin, flags)) return;

    postWin.routingStatus = "FALLBACK";
    postWin.notes = "ESCALATED: Requires human review due to integrity flags.";

    await this.ledgerService.commit({
      timestamp: Date.now(),
      postWinId: postWin.id,
      action: "FLAGGED",
      actorId: "POSTA_AI_SAFETY",
      previousState: "ROUTING",
      newState: "HUMAN_REVIEW_REQUIRED"
    });
  }
}
