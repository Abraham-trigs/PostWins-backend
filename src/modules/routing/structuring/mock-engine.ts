// filepath: apps/backend/src/modules/routing/structuring/mock-engine.ts

/**
 * PostaMockEngine
 * -------------------------------------------------------------------
 * Purpose:
 *  - Simulate a full PostWin lifecycle without HTTP or UI
 *  - Validate domain contracts between Intake → Routing → Verification
 *  - Act as a regression harness for PostWins core logic
 *
 * IMPORTANT:
 *  - This is NOT a test double.
 *  - This is a domain simulation that should break when contracts drift.
 */

import { IntakeService } from "../../intake/intake.service";
import { PostWinRoutingService } from "./postwin-routing.service";
import { VerificationService } from "../../verification/verification.service";
import { PostWin, ExecutionBody } from "@posta/core";
import { TaskId } from "../../../domain/tasks/taskIds";

export class PostaMockEngine {
  constructor(
    private intake: IntakeService,
    private router: PostWinRoutingService,
    private verifier: VerificationService,
  ) {}

  async runSimulation() {
    try {
      console.log("🚀 Starting Mock Simulation: SDG 4 - Primary Education");

      // ------------------------------------------------------------------
      // STEP 1: INTAKE
      // ------------------------------------------------------------------
      const partialPW = await this.intake.handleIntake(
        "I need support for school enrollment",
        "device_rural_001",
      );

      // ------------------------------------------------------------------
      // STEP 2: EXECUTION BODIES (Mock Data)
      // ------------------------------------------------------------------
      const bodies: ExecutionBody[] = [
        {
          id: "NGO_LOCAL",
          name: "Village Support",
          location: { lat: 5.1, lng: -0.1, radius: 10 },
          capabilities: ["SDG_4"],
          trustScore: 0.9,
        },
      ];

      // ------------------------------------------------------------------
      // STEP 3: POSTWIN CONSTRUCTION
      // ------------------------------------------------------------------
      const mockPostWin: PostWin = {
        ...partialPW,

        id: "pw_mock_123",
        beneficiaryId: "ben_001",

        // Phase 1.5: deterministic, canonical task
        taskId: TaskId.START,

        location: { lat: 5.101, lng: -0.101 },
        sdgGoals: ["SDG_4"],

        auditTrail: partialPW.auditTrail || [],
        verificationRecords: { SDG_4: [] } as any,

        routingStatus: "UNASSIGNED",
        verificationStatus: "PENDING",

        description: "School support",
      } as PostWin;

      // ------------------------------------------------------------------
      // STEP 4: ROUTING
      // ------------------------------------------------------------------
      console.log("Step 2: Routing to nearest Execution Body...");
      const routedPW = await this.router.processPostWin(mockPostWin, bodies, [
        "SDG_4",
      ]);

      if (routedPW.routingStatus === "BLOCKED") {
        console.error(`❌ Routing Blocked: ${routedPW.notes}`);
        return;
      }

      console.log(
        `Step 3: Routed to ${routedPW.assignedBodyId}. Awaiting Multi-Verifier Consensus...`,
      );

      // ------------------------------------------------------------------
      // STEP 5: MULTI-ACTOR VERIFICATION
      // ------------------------------------------------------------------
      const stateAfterCommunity = await this.verifier.recordVerification(
        routedPW,
        "community_leader_01",
        "SDG_4",
      );

      const finalState = await this.verifier.recordVerification(
        stateAfterCommunity,
        "ngo_staff_01",
        "SDG_4",
      );

      // ------------------------------------------------------------------
      // STEP 6: AUDIT OUTPUT
      // ------------------------------------------------------------------
      console.log("\n" + "=".repeat(50));
      console.log("✅ Simulation Complete.");
      console.log(`Final Status: ${finalState.verificationStatus}`);

      const trail = finalState.auditTrail ?? [];
      console.log(`Total Audit Trail Entries: ${trail.length}`);

      console.log("=".repeat(50));

      console.log("\n📜 FULL AUDIT TRAIL:");
      trail.forEach((entry, idx) => {
        const ts =
          typeof (entry as any).ts === "bigint"
            ? new Date(Number((entry as any).ts)).toISOString()
            : typeof (entry as any).ts === "number"
              ? new Date((entry as any).ts).toISOString()
              : "unknown-time";

        const action = (entry as any).action ?? "UNKNOWN_ACTION";
        console.log(`[${idx + 1}] ${ts} | ${String(action).padEnd(22)}`);
      });

      console.log("=".repeat(50) + "\n");
    } catch (error) {
      console.error("❌ Mock Simulation Failed:", error);
    }
  }
}
