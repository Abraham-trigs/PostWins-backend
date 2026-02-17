// filepath: apps/backend/src/modules/routing/structuring/mock-engine.ts
// Phase 1.5-compliant mock simulation engine aligned with ledger-authoritative verification service.

import { IntakeService } from "../../intake/intake.service";
import { PostWinRoutingService } from "./postwin-routing.service";
import { VerificationService } from "../../verification/verification.service";
import { PostWin, ExecutionBody } from "@posta/core";
import { TaskId, VerificationStatus } from "@prisma/client";

/**
 * Assumptions:
 * - routed PostWin exposes verificationRecordId after routing.
 * - VerificationRecord already exists in DB.
 * - Execution for the Case is COMPLETED before verification.
 * - This simulation does NOT mutate lifecycle directly.
 */
export class PostaMockEngine {
  constructor(
    private intake: IntakeService,
    private router: PostWinRoutingService,
    private verifier: VerificationService,
  ) {}

  async runSimulation(): Promise<void> {
    try {
      console.log("🚀 Starting Mock Simulation: SDG 4 - Primary Education");

      ////////////////////////////////////////////////////////////////
      // 1️⃣ INTAKE
      ////////////////////////////////////////////////////////////////

      const partialPW = await this.intake.handleIntake(
        "I need support for school enrollment",
        "device_rural_001",
      );

      ////////////////////////////////////////////////////////////////
      // 2️⃣ MOCK EXECUTION BODIES
      ////////////////////////////////////////////////////////////////

      const bodies: ExecutionBody[] = [
        {
          id: "NGO_LOCAL",
          name: "Village Support",
          location: { lat: 5.1, lng: -0.1, radius: 10 },
          capabilities: ["SDG_4"],
          trustScore: 0.9,
        },
      ];

      ////////////////////////////////////////////////////////////////
      // 3️⃣ CONSTRUCT SIMULATION POSTWIN
      ////////////////////////////////////////////////////////////////

      const mockPostWin: PostWin = {
        ...partialPW,
        id: "pw_mock_123",
        beneficiaryId: "ben_001",
        taskId: TaskId.START,
        location: { lat: 5.101, lng: -0.101 },
        sdgGoals: ["SDG_4"],
        description: "School support",
        auditTrail: partialPW.auditTrail ?? [],
        verificationRecords: partialPW.verificationRecords ?? {},
        routingStatus: "UNASSIGNED",
        verificationStatus: "PENDING",
      } as PostWin;

      ////////////////////////////////////////////////////////////////
      // 4️⃣ ROUTING
      ////////////////////////////////////////////////////////////////

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

      if (!("verificationRecordId" in routedPW)) {
        throw new Error(
          "Mock engine requires routed PostWin to expose verificationRecordId",
        );
      }

      const verificationRecordId = (routedPW as any)
        .verificationRecordId as string;

      ////////////////////////////////////////////////////////////////
      // 5️⃣ MULTI-ACTOR VERIFICATION (Ledger-backed)
      ////////////////////////////////////////////////////////////////

      const stateAfterCommunity = await this.verifier.recordVerification({
        verificationRecordId,
        verifierUserId: "community_leader_01",
        status: VerificationStatus.APPROVED,
      });

      const finalState = await this.verifier.recordVerification({
        verificationRecordId,
        verifierUserId: "ngo_staff_01",
        status: VerificationStatus.APPROVED,
      });

      ////////////////////////////////////////////////////////////////
      // 6️⃣ OUTPUT
      ////////////////////////////////////////////////////////////////

      console.log("\n" + "=".repeat(60));
      console.log("✅ Simulation Complete.");

      console.log(
        `Consensus Reached: ${finalState.consensusReached ? "YES" : "NO"}`,
      );

      if (finalState.record) {
        console.log(
          `Verified At: ${finalState.record.verifiedAt?.toISOString()}`,
        );
        console.log(
          `Required Verifiers: ${finalState.record.requiredVerifiers}`,
        );
      }

      console.log("=".repeat(60) + "\n");
    } catch (error) {
      console.error("❌ Mock Simulation Failed:", error);
      throw error;
    }
  }
}

/*
Design reasoning
----------------
Phase 1.5 is ledger-authoritative.
VerificationService returns deterministic DB-backed consensus results.
Mock engine must not fabricate auditTrail or verificationStatus.
Verification state is sourced from VerificationRecord only.

Structure
---------
1. Intake
2. Mock routing
3. Extract verificationRecordId
4. Record votes via object-based API
5. Output consensus result
6. No lifecycle mutation

Implementation guidance
-----------------------
- Ensure routing layer creates VerificationRecord and exposes its ID.
- Execution must be COMPLETED before verification (service enforces invariant).
- Votes must use UUID verifier IDs in real DB.
- LedgerService must be injected into VerificationService constructor.

Scalability insight
-------------------
- Ledger remains single source of historical truth.
- Verification state replayable from ledger + DB.
- Mock simulation now mirrors production execution flow.
- No architectural shortcuts that violate sovereign model.
*/
