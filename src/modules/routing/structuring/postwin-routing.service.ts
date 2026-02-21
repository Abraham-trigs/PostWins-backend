/**
 * 🚫 GOVERNANCE NOTICE
 * --------------------------------------------------
 * This service operates strictly as a routing projection layer.
 *
 * It MUST NOT:
 * - read Case.lifecycle
 * - write Case.lifecycle
 * - infer Case.lifecycle
 * - mutate verification state
 * - commit ledger entries
 *
 * Governance authority belongs exclusively to:
 * - Lifecycle services
 * - Execution services
 * - Verification services
 * - Ledger commit layer
 */

import { EventEmitter } from "events";
import { PostWin, ExecutionBody, Journey } from "@posta/core";
import { TaskService } from "./task.service";
import { JourneyService } from "../journey/journey.service";

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
  ) {
    super();
  }

  /**
   * Reliable emission helper with exponential backoff.
   * This emits projection events only.
   */
  private async emitWithRetry(
    eventName: string,
    payload: unknown,
    attempt: number = 0,
  ): Promise<void> {
    try {
      this.emit(eventName, payload);
    } catch (error) {
      if (attempt < this.MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * this.BASE_DELAY_MS;

        await new Promise((resolve) => setTimeout(resolve, delay));

        return this.emitWithRetry(eventName, payload, attempt + 1);
      }

      this.emit("ROUTING_DLQ", {
        originalEvent: eventName,
        payload,
        error:
          error instanceof Error
            ? error.message
            : "Downstream Listener Failure",
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Core routing entrypoint.
   *
   * This method:
   * - Validates task sequence
   * - Routes to an execution body
   * - Returns projection updates
   *
   * It does NOT:
   * - Mutate lifecycle
   * - Mutate verification
   * - Commit ledger
   */
  async processPostWin(
    postWin: PostWin,
    availableBodies: ExecutionBody[],
    sdgGoals: string[] = ["SDG_4"],
  ): Promise<PostWin> {
    const beneficiaryId = postWin.beneficiaryId ?? "unknown";
    const taskId = postWin.taskId ?? "ENROLL";

    // Stateless journey projection (no persistence)
    const journey: Journey = {
      beneficiaryId,
      completedTaskIds: [],
    };

    // Validate task sequence integrity
    const taskValid = this.taskService.validateTaskSequence(journey, taskId);

    if (!taskValid) {
      return {
        ...postWin,
        routingStatus: "BLOCKED",
        notes: `Cannot perform task ${taskId} before completing required dependencies.`,
      };
    }

    // Rank bodies deterministically
    const rankedBodies = this.journeyService.rankBodies(
      postWin,
      availableBodies,
    );

    const assignedBodyId = rankedBodies[0]?.id;

    const routingStatus = assignedBodyId ? "MATCHED" : "FALLBACK";

    const projectedPostWin: PostWin = {
      ...postWin,
      assignedBodyId: assignedBodyId ?? undefined,
      routingStatus,
    };

    await this.emitWithRetry("ROUTING_COMPLETE", {
      postWinId: projectedPostWin.id,
      routingStatus,
      assignedBodyId: projectedPostWin.assignedBodyId,
    });

    return projectedPostWin;
  }

  /**
   * Projection-only escalation signal.
   *
   * Does NOT commit ledger.
   * Does NOT mutate lifecycle.
   * Returns suggested routing override.
   */
  evaluateEscalation(
    postWin: PostWin,
    flags: IntegrityFlag[],
  ): { escalated: boolean; reason?: string } {
    const hasHighSeverityFlag = flags.some((f) => f.severity === "HIGH");
    const isLowConfidence = (postWin.localization?.confidence ?? 1) < 0.7;

    if (hasHighSeverityFlag || isLowConfidence) {
      return {
        escalated: true,
        reason: "Requires human review due to integrity or confidence risk.",
      };
    }

    return { escalated: false };
  }
}
