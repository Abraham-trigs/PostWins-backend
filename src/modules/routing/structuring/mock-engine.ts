// apps/backend/src/modules/routing/structuring/mock-engine.ts
// Purpose: Fully constitutional ledger-accurate mock simulation following lifecycle law.

//////////////////////////////////////////////////////////////////
// Assumptions
//////////////////////////////////////////////////////////////////
// - transitionCaseLifecycleWithLedger enforces transition matrix.
// - Allowed path: INTAKE → ROUTED → ACCEPTED → EXECUTING → VERIFIED
// - completeExecution does NOT mutate lifecycle directly.
// - VerificationService triggers VERIFIED via decision orchestration.

//////////////////////////////////////////////////////////////////
// Design Reasoning
//////////////////////////////////////////////////////////////////
// The mock must follow lifecycle constitutional order. Direct jumps
// (INTAKE → EXECUTING) are illegal. Therefore this simulation
// performs every legal transition in sequence before execution
// completion and verification consensus. This preserves governance
// integrity and ledger correctness.

//////////////////////////////////////////////////////////////////
// Structure
//////////////////////////////////////////////////////////////////
// 1. Tenant + Users
// 2. Role configuration (VERIFIER)
// 3. Case creation
// 4. Lawful lifecycle transitions (INTAKE → ROUTED → ACCEPTED → EXECUTING)
// 5. Execution creation + evidence
// 6. Execution completion
// 7. Verification approvals
// 8. Final lifecycle confirmation

//////////////////////////////////////////////////////////////////
// Implementation
//////////////////////////////////////////////////////////////////

import { prisma } from "@/lib/prisma";
import { IntakeService } from "../../intake/intake.service";
import { VerificationService } from "../../verification/verification.service";
import { completeExecution } from "@/modules/execution/completeExecution.service";
import { transitionCaseLifecycleWithLedger } from "@/modules/cases/transitionCaseLifecycleWithLedger";
import {
  TaskId,
  VerificationStatus,
  ActorKind,
  ExecutionStatus,
} from "@prisma/client";
import { CaseLifecycle } from "@/modules/cases/CaseLifecycle";
import crypto from "node:crypto";

export class PostaMockEngine {
  constructor(
    private intake: IntakeService,
    private verifier: VerificationService,
  ) {}

  async runSimulation(): Promise<void> {
    console.log("🚀 Starting PostWin Ledger-Accurate Simulation");

    ////////////////////////////////////////////////////////////////
    // 1️⃣ Tenant
    ////////////////////////////////////////////////////////////////

    const tenant = await prisma.tenant.create({
      data: {
        name: "Mock Tenant",
        slug: `mock-${crypto.randomUUID().slice(0, 8)}`,
      },
    });

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Users
    ////////////////////////////////////////////////////////////////

    const author = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Mock Author",
        email: `author-${crypto.randomUUID()}@mock.test`,
        isActive: true,
      },
    });

    const verifierA = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Verifier A",
        email: `verifierA-${crypto.randomUUID()}@mock.test`,
        isActive: true,
      },
    });

    const verifierB = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: "Verifier B",
        email: `verifierB-${crypto.randomUUID()}@mock.test`,
        isActive: true,
      },
    });

    ////////////////////////////////////////////////////////////////
    // 3️⃣ Beneficiary
    ////////////////////////////////////////////////////////////////

    const beneficiary = await prisma.beneficiary.create({
      data: {
        tenantId: tenant.id,
        displayName: "Ama Mensah",
      },
    });

    ////////////////////////////////////////////////////////////////
    // 4️⃣ Intake classification
    ////////////////////////////////////////////////////////////////

    const intakeResult = await this.intake.handleIntake(
      "I need support for school enrollment",
      "device_mock_001",
    );

    ////////////////////////////////////////////////////////////////
    // 5️⃣ VERIFIER Role + Assignment
    ////////////////////////////////////////////////////////////////

    const verifierRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        key: "VERIFIER",
        name: "Case Verifier",
      },
    });

    await prisma.userRole.createMany({
      data: [
        { userId: verifierA.id, roleId: verifierRole.id },
        { userId: verifierB.id, roleId: verifierRole.id },
      ],
    });

    ////////////////////////////////////////////////////////////////
    // 6️⃣ Create Case (INTAKE)
    ////////////////////////////////////////////////////////////////

    const createdCase = await prisma.case.create({
      data: {
        referenceCode: crypto.randomUUID(),
        tenantId: tenant.id,
        authorUserId: author.id,
        beneficiaryId: beneficiary.id,
        mode: intakeResult.mode,
        scope: intakeResult.scope,
        type: intakeResult.intent,
        lifecycle: CaseLifecycle.INTAKE,
        currentTask: TaskId.START,
        summary: "School enrollment support",
      },
    });

    ////////////////////////////////////////////////////////////////
    // 7️⃣ Lawful Lifecycle Progression
    ////////////////////////////////////////////////////////////////

    const actor = {
      kind: ActorKind.SYSTEM,
      authorityProof: "MOCK_ENGINE_LIFECYCLE",
    };

    await transitionCaseLifecycleWithLedger({
      tenantId: tenant.id,
      caseId: createdCase.id,
      target: CaseLifecycle.ROUTED,
      actor,
    });

    await transitionCaseLifecycleWithLedger({
      tenantId: tenant.id,
      caseId: createdCase.id,
      target: CaseLifecycle.ACCEPTED,
      actor,
    });

    await prisma.execution.create({
      data: {
        tenantId: tenant.id,
        caseId: createdCase.id,
        status: ExecutionStatus.IN_PROGRESS,
      },
    });

    ////////////////////////////////////////////////////////////////
    // 8️⃣ Create Execution
    ////////////////////////////////////////////////////////////////

    await transitionCaseLifecycleWithLedger({
      tenantId: tenant.id,
      caseId: createdCase.id,
      target: CaseLifecycle.EXECUTING,
      actor,
    });

    ////////////////////////////////////////////////////////////////
    // 9️⃣ Insert Timeline + Evidence
    ////////////////////////////////////////////////////////////////

    const timelineEntry = await prisma.timelineEntry.create({
      data: {
        tenantId: tenant.id,
        caseId: createdCase.id,
        type: "DELIVERY",
        body: "Mock delivery evidence entry",
      },
    });

    await prisma.evidence.create({
      data: {
        tenantId: tenant.id,
        timelineEntryId: timelineEntry.id,
        kind: "PHOTO",
        storageKey: "mock/photo.jpg",
        sha256: crypto.createHash("sha256").update("mock-photo").digest("hex"),
        mimeType: "image/jpeg",
        byteSize: 1024,
      },
    });

    ////////////////////////////////////////////////////////////////
    // 🔟 Complete Execution
    ////////////////////////////////////////////////////////////////

    await completeExecution({
      tenantId: tenant.id,
      caseId: createdCase.id,
      actorKind: ActorKind.SYSTEM,
      authorityProof: "MOCK_ENGINE_EXECUTION_COMPLETE",
    });

    // 🔎 DEBUG — confirm execution status after completion
    const exec = await prisma.execution.findUnique({
      where: { caseId: createdCase.id },
      select: { status: true, completedAt: true },
    });

    console.log("Execution Status After Completion:", exec);

    ////////////////////////////////////////////////////////////////
    // 1️⃣1️⃣ Verification Consensus
    ////////////////////////////////////////////////////////////////

    const verificationRecord = await prisma.verificationRecord.findFirst({
      where: {
        tenantId: tenant.id,
        caseId: createdCase.id,
        consensusReached: false,
      },
    });

    if (!verificationRecord) {
      throw new Error("VerificationRecord not initialized");
    }

    await this.verifier.recordVerification({
      verificationRecordId: verificationRecord.id,
      verifierUserId: verifierA.id,
      status: VerificationStatus.APPROVED,
    });

    const finalState = await this.verifier.recordVerification({
      verificationRecordId: verificationRecord.id,
      verifierUserId: verifierB.id,
      status: VerificationStatus.APPROVED,
    });

    console.log("Consensus Reached:", finalState.consensusReached);

    ////////////////////////////////////////////////////////////////
    // 1️⃣2️⃣ Final Lifecycle Check
    ////////////////////////////////////////////////////////////////

    const finalCase = await prisma.case.findUnique({
      where: { id: createdCase.id },
      select: { lifecycle: true },
    });

    console.log("Final Lifecycle:", finalCase?.lifecycle);
  }
}

//////////////////////////////////////////////////////////////////
// Scalability Insight execution.create
//////////////////////////////////////////////////////////////////
// This simulation now mirrors production constitutional flow.
// Additional routing decisions, execution milestones, or grant
// disbursements can be layered without breaking lifecycle law.
// Because transitions are ledger-backed, governance integrity
// scales with system complexity.
//////////////////////////////////////////////////////////////////
