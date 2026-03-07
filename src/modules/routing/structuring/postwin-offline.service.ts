// filepath: apps/backend/src/modules/routing/structuring/postwin-offline.service.ts
// Purpose: Offline intake queue processor that safely replays queued intake commands
// into the intake + routing pipeline using a trusted system TrustContext.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
Offline intake allows the system to accept requests even when the main
processing pipeline is unavailable. This service queues incoming intake
requests and periodically replays them through the same intake and routing
pipeline used in the live system.

The service intentionally uses a synthetic TrustContext because offline
events are system-originated and not tied to a real device session. By
generating the TrustContext per item inside the loop we ensure the correct
tenant and actor context is preserved for each replay operation.

Failures are requeued safely so no intake request is lost.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- PostWinOfflineService

Responsibilities
- enqueueIntake(): queue offline intake commands
- startBackgroundSync(): replay queued items periodically
*/

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import { IntakeService } from "../../intake/services/intake.service";
import { PostWinRoutingService } from "./postwin-routing.service";
import { ExecutionBody, PostWin } from "@posta/core";
import { TrustContext } from "@/modules/auth/trust/trust.context";

///////////////////////////////////////////////////////////////
// Types
///////////////////////////////////////////////////////////////

interface OfflineIntakeItem {
  tenantId: string;
  beneficiaryId: string;
  message: string;
  partnerUserId?: string;
}

///////////////////////////////////////////////////////////////
// Service
///////////////////////////////////////////////////////////////

export class PostWinOfflineService {
  /**
   * In-memory offline queue.
   * In production this could be replaced with Redis or a durable queue.
   */
  private queue: OfflineIntakeItem[] = [];

  constructor(
    private intake: IntakeService,
    private router: PostWinRoutingService,
  ) {
    this.startBackgroundSync();
  }

  //////////////////////////////////////////////////////////////
  // Enqueue intake request
  //////////////////////////////////////////////////////////////

  /**
   * Adds an intake command to the offline queue.
   */
  async enqueueIntake(params: OfflineIntakeItem) {
    this.queue.push(params);

    console.log(
      `Intake queued for beneficiary ${params.beneficiaryId} (tenant ${params.tenantId})`,
    );
  }

  //////////////////////////////////////////////////////////////
  // Background sync loop
  //////////////////////////////////////////////////////////////

  /**
   * Background worker that periodically processes the offline queue.
   */
  private startBackgroundSync() {
    setInterval(async () => {
      if (this.queue.length === 0) return;

      const itemsToSync = [...this.queue];
      this.queue = [];

      for (const item of itemsToSync) {
        try {
          ////////////////////////////////////////////////////////////
          // 1️⃣ Build TrustContext for this offline request
          ////////////////////////////////////////////////////////////

          const trust: TrustContext = {
            tenantId: item.tenantId,
            actorUserId: item.partnerUserId ?? "offline-system",
            deviceId: "offline_device",
            isTrusted: true,
          };

          ////////////////////////////////////////////////////////////
          // 2️⃣ Intake classification
          ////////////////////////////////////////////////////////////

          const intakeResult = await this.intake.handleIntake(
            item.message,
            trust,
          );

          ////////////////////////////////////////////////////////////
          // 3️⃣ Minimal PostWin projection
          ////////////////////////////////////////////////////////////

          const projectedPostWin: PostWin = {
            id: "offline_projection",
            referenceCode: "OFFLINE",
            status: "INTAKED",
            lifecycle: "INTAKE",
            type: intakeResult.intent,
            mode: intakeResult.mode,
            scope: intakeResult.scope,
            beneficiaryId: item.beneficiaryId,
            routingStatus: "UNASSIGNED",
            summary: intakeResult.description,
            createdAt: new Date().toISOString(),
          };

          ////////////////////////////////////////////////////////////
          // 4️⃣ Routing projection
          ////////////////////////////////////////////////////////////

          const availableBodies: ExecutionBody[] = [];

          await this.router.processPostWin(
            projectedPostWin,
            availableBodies,
            projectedPostWin.sdgGoal ? [projectedPostWin.sdgGoal] : [],
          );

          console.log(`Synced intake for beneficiary ${item.beneficiaryId}`);
        } catch (err) {
          console.error(`Failed to sync intake for ${item.beneficiaryId}`, err);

          ////////////////////////////////////////////////////////////
          // Requeue item safely
          ////////////////////////////////////////////////////////////

          this.queue.push(item);
        }
      }
    }, 5000);
  }
}

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Example usage

const offlineService = new PostWinOfflineService(
  new IntakeService(...),
  new PostWinRoutingService(...)
);

await offlineService.enqueueIntake({
  tenantId: "tenant-uuid",
  beneficiaryId: "beneficiary-uuid",
  message: "Need school supplies support",
  partnerUserId: "user-uuid",
});
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
For production workloads the in-memory queue should be replaced with
a durable queue (Redis, Kafka, SQS, or Postgres job table). That
ensures offline requests survive process restarts and scale across
multiple worker instances.
*/
