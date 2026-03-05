// filepath: apps/backend/src/modules/routing/structuring/postwin-offline.service.ts

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
  // Enqueue raw intake command
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
          // 1️⃣ Intake processing
          ////////////////////////////////////////////////////////////////

          const intakeResult = await this.intake.handleIntake(
            item.message,
            "offline_device",
          );

          ////////////////////////////////////////////////////////////////
          // 2️⃣ Minimal projection (transport-safe PostWin stub)
          ////////////////////////////////////////////////////////////////

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

          ////////////////////////////////////////////////////////////////
          // 3️⃣ Routing projection
          ////////////////////////////////////////////////////////////////

          const availableBodies: ExecutionBody[] = [];

          await this.router.processPostWin(
            projectedPostWin,
            availableBodies,
            projectedPostWin.sdgGoal ? [projectedPostWin.sdgGoal] : [],
          );

          console.log(`Synced intake for beneficiary ${item.beneficiaryId}`);
        } catch (err) {
          console.error(`Failed to sync intake for ${item.beneficiaryId}`, err);

          // Requeue safely
          this.queue.push(item);
        }
      }
    }, 5000);
  }
}
