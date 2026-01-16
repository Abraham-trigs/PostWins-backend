"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostaMockEngine = void 0;
class PostaMockEngine {
    intake;
    router;
    verifier;
    constructor(intake, router, verifier) {
        this.intake = intake;
        this.router = router;
        this.verifier = verifier;
    }
    async runSimulation() {
        console.log("🚀 Starting Mock Simulation: SDG 4 - Primary Education");
        // STEP 1: Intake
        const partialPW = await this.intake.handleIntake("I need support for school enrollment", "device_rural_001");
        // Mock execution bodies
        const bodies = [
            {
                id: "NGO_LOCAL",
                name: "Village Support",
                location: { lat: 5.1, lng: -0.1, radius: 10 },
                capabilities: ["SDG_4"],
                trustScore: 0.9
            }
        ];
        // Construct PostWin candidate
        // Note: taskId set to 'START' to pass TaskService validation
        const mockPostWin = {
            ...partialPW,
            id: "pw_mock_123",
            beneficiaryId: "ben_001",
            taskId: "t1",
            location: { lat: 5.101, lng: -0.101 },
            sdgGoals: ["SDG_4"],
            auditTrail: partialPW.auditTrail || [],
            verificationRecords: [],
            routingStatus: "UNASSIGNED",
            verificationStatus: "PENDING",
            description: "School support"
        };
        // STEP 2: Routing
        console.log("Step 2: Routing to nearest Execution Body...");
        const fullPW = await this.router.processPostWin(mockPostWin, bodies, ["SDG_4"]);
        // Safety Check: If routing failed/blocked, stop before verification crash
        if (fullPW.routingStatus === "BLOCKED") {
            console.error(`❌ Routing Blocked: ${fullPW.notes}`);
            return;
        }
        // STEP 3: Logging
        console.log(`Step 3: Routed to ${fullPW.assignedBodyId}. Awaiting Multi-Verifier Consensus...`);
        // STEP 4: Multi-verifier consensus
        // VerificationService requires the key "SDG_4" to exist in fullPW.verificationRecords
        await this.verifier.recordVerification(fullPW, "community_leader_01", "SDG_4");
        const finalState = await this.verifier.recordVerification(fullPW, "ngo_staff_01", "SDG_4");
        console.log("\n" + "=".repeat(50));
        console.log("✅ Simulation Complete.");
        console.log(`Final Status: ${finalState.verificationStatus}`);
        console.log(`Total Audit Trail Entries: ${finalState.auditTrail.length}`);
        console.log("=".repeat(50));
        console.log("\n📜 FULL AUDIT TRAIL:");
        finalState.auditTrail.forEach((entry, idx) => {
            // Use .toString() if timestamp is a number, or just the string if ISO
            const ts = typeof entry.timestamp === 'number' ? new Date(entry.timestamp).toISOString() : entry.timestamp;
            console.log(`[${idx + 1}] ${ts} | ${entry.action.padEnd(22)} | Actor: ${entry.actor}`);
            if (entry.note)
                console.log(`    Note: ${entry.note}`);
        });
        console.log("=".repeat(50) + "\n");
    } // End of runSimulation
} // End of class
exports.PostaMockEngine = PostaMockEngine;
