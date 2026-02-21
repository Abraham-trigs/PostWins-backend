// filepath: apps/backend/src/modules/routing/structuring/postwin-offline.service.ts
// Purpose: Offline intake queue for Case creation replay.
// Transport-only. No lifecycle mutation.
// No verification logic.
// No ledger logic.

import { IntakeService } from "../../intake/intake.service";
import { PostWinRoutingService } from "./postwin-routing.service";
import { ExecutionBody, PostWin } from "@posta/core";

interface OfflineIntakeItem {
  tenantId: string;
  beneficiaryId: string;
  message: string;
  partnerUserId?: string;
}

export class PostWinOfflineService {
  private queue: OfflineIntakeItem[] = [];

  constructor(
    private intake: IntakeService,
    private router: PostWinRoutingService,
  ) {
    this.startBackgroundSync();
  }

  ////////////////////////////////////////////////////////////////
  // Enqueue raw intake command (transport only)
  ////////////////////////////////////////////////////////////////

  async enqueueIntake(params: OfflineIntakeItem) {
    this.queue.push(params);

    console.log(
      `Intake queued for beneficiary ${params.beneficiaryId} (tenant ${params.tenantId})`,
    );
  }

  ////////////////////////////////////////////////////////////////
  // Background synchronization loop
  ////////////////////////////////////////////////////////////////

  private startBackgroundSync() {
    setInterval(async () => {
      if (this.queue.length === 0) return;

      const itemsToSync = [...this.queue];
      this.queue = [];

      for (const item of itemsToSync) {
        try {
          ////////////////////////////////////////////////////////////////
          // 1️⃣ Intake (domain command)
          ////////////////////////////////////////////////////////////////

          const intakeResult = await this.intake.handleIntake(
            item.message,
            "offline_device",
          );

          ////////////////////////////////////////////////////////////////
          // 2️⃣ Projection-only routing (no lifecycle mutation)
          ////////////////////////////////////////////////////////////////

          const projectedPostWin: PostWin = {
            id: intakeResult.id ?? "offline_projection",
            beneficiaryId: item.beneficiaryId,
            taskId: intakeResult.taskId,
            mode: intakeResult.mode,
            scope: intakeResult.scope,
            intent: intakeResult.intent,
            sdgGoals: intakeResult.sdgGoals ?? [],
            routingStatus: "PENDING",
          };

          const availableBodies: ExecutionBody[] = [];

          await this.router.processPostWin(
            projectedPostWin,
            availableBodies,
            intakeResult.sdgGoals ?? [],
          );

          console.log(`Synced intake for beneficiary ${item.beneficiaryId}`);
        } catch (err) {
          console.error(`Failed to sync intake for ${item.beneficiaryId}`, err);

          // Safe requeue
          this.queue.push(item);
        }
      }
    }, 5000);
  }
}
