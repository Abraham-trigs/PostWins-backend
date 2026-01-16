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

export class PostaMockEngine {
  constructor(
    /**
     * IntakeService
     *  - Canonical entrypoint for all new PostWins
     *  - Responsible for integrity checks, context detection, audit bootstrapping
     */
    private intake: IntakeService,

    /**
     * PostWinRoutingService
     *  - Assigns a PostWin to a trusted ExecutionBody
     *  - Evaluates distance, capability, trust score, SDG alignment
     */
    private router: PostWinRoutingService,

    /**
     * VerificationService
     *  - Records multi-actor confirmations over time
     *  - Drives PostWin toward VERIFIED or DISPUTED state
     */
    private verifier: VerificationService
  ) {}

  /**
   * runSimulation
   * -----------------------------------------------------------------
   * Executes a full mock lifecycle:
   *  1. Intake (message → partial PostWin)
   *  2. Routing (assign execution body)
   *  3. Verification (multi-actor consensus)
   *  4. Audit trail inspection
   */
  async runSimulation() {
    try {
      console.log("🚀 Starting Mock Simulation: SDG 4 - Primary Education");

      // ------------------------------------------------------------------
      // STEP 1: INTAKE
      // ------------------------------------------------------------------
      // Simulates a beneficiary submitting a real-world request.
      // IntakeService is expected to:
      //  - detect context & literacy
      //  - run integrity checks
      //  - initialize audit trail
      //  - return a Partial<PostWin>
      const partialPW = await this.intake.handleIntake(
        "I need support for school enrollment",
        "device_rural_001"
      );

      // ------------------------------------------------------------------
      // STEP 2: EXECUTION BODIES (Mock Data)
      // ------------------------------------------------------------------
      // Execution bodies represent NGOs / community actors capable
      // of fulfilling a PostWin. In production these come from registry.
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
      // We now promote the partial PostWin into a routable candidate.
      //
      // NOTE:
      //  - taskId is set to "START" to satisfy TaskService validation
      //  - verificationRecords are initialized with SDG keys
      //  - auditTrail is preserved from intake
      const mockPostWin: PostWin = {
        ...partialPW,

        // Identity
        id: "pw_mock_123",
        beneficiaryId: "ben_001",

        // Workflow bootstrap
        taskId: "START",

        // Domain fields required for routing
        location: { lat: 5.101, lng: -0.101 },
        sdgGoals: ["SDG_4"],

        // Governance + trust
        auditTrail: partialPW.auditTrail || [],
        verificationRecords: { SDG_4: [] } as any,

        // Initial state flags
        routingStatus: "UNASSIGNED",
        verificationStatus: "PENDING",

        // Human-readable summary
        description: "School support",
      } as PostWin;

      // ------------------------------------------------------------------
      // STEP 4: ROUTING
      // ------------------------------------------------------------------
      // Routing assigns the PostWin to the best execution body
      // based on trust, distance, and capability.
      console.log("Step 2: Routing to nearest Execution Body...");
      const routedPW = await this.router.processPostWin(
        mockPostWin,
        bodies,
        ["SDG_4"]
      );

      // Guardrail:
      // If routing is blocked, we stop early.
      // This prevents invalid verification attempts.
      if (routedPW.routingStatus === "BLOCKED") {
        console.error(`❌ Routing Blocked: ${routedPW.notes}`);
        return;
      }

      console.log(
        `Step 3: Routed to ${routedPW.assignedBodyId}. Awaiting Multi-Verifier Consensus...`
      );

      // ------------------------------------------------------------------
      // STEP 5: MULTI-ACTOR VERIFICATION
      // ------------------------------------------------------------------
      // Verification is sequential and stateful.
      // Each call returns an updated PostWin.
      const stateAfterCommunity = await this.verifier.recordVerification(
        routedPW,
        "community_leader_01",
        "SDG_4"
      );

      const finalState = await this.verifier.recordVerification(
        stateAfterCommunity,
        "ngo_staff_01",
        "SDG_4"
      );

      // ------------------------------------------------------------------
      // STEP 6: AUDIT OUTPUT
      // ------------------------------------------------------------------
      console.log("\n" + "=".repeat(50));
      console.log("✅ Simulation Complete.");
      console.log(`Final Status: ${finalState.verificationStatus}`);
      console.log(`Total Audit Trail Entries: ${finalState.auditTrail.length}`);
      console.log("=".repeat(50));

      console.log("\n📜 FULL AUDIT TRAIL:");
      finalState.auditTrail.forEach((entry, idx) => {
        const ts =
          typeof entry.timestamp === "number"
            ? new Date(entry.timestamp).toISOString()
            : entry.timestamp;

        console.log(
          `[${idx + 1}] ${ts} | ${entry.action.padEnd(22)} | Actor: ${entry.actor}`
        );

        if (entry.note) {
          console.log(`    Note: ${entry.note}`);
        }
      });

      console.log("=".repeat(50) + "\n");
    } catch (error) {
      // ------------------------------------------------------------------
      // FAILURE HANDLING
      // ------------------------------------------------------------------
      // Any failure here indicates a broken domain contract.
      // This is intentional: the mock engine should fail loudly.
      console.error("❌ Mock Simulation Failed:", error);
    }
  }
}
