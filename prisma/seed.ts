// prisma/seed.ts
// Purpose: Production-grade realistic governance seed (single-tenant, lifecycle coherent)

import crypto from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

/* ============================================================
   DETERMINISTIC LEDGER CLOCK
============================================================ */

let clock = BigInt(Date.now());

function nextTs(): bigint {
  clock += BigInt(1);
  return clock;
}

function sha256(payload: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

/* ============================================================
   SAFE RESET (POSTGRES CASCADE TRUNCATE)
============================================================ */

async function resetDatabase() {
  // Order does not matter because CASCADE handles FKs
  const tables = [
    "TrancheEvent",
    "Tranche",
    "BudgetAllocation",
    "GrantConstraint",
    "GrantCase",
    "Grant",
    "Disbursement",
    "CounterfactualRecord",
    "AppealDecision",
    "Appeal",
    "CaseReasonCode",
    "AuditEntry",
    "Evidence",
    "TimelineEntry",
    "LedgerCommit",
    "Decision",
    "ApprovalRequest",
    "Verification",
    "VerificationRequiredRole",
    "VerificationRecord",
    "ExecutionProgress",
    "ExecutionMilestone",
    "Execution",
    "CaseAssignment",
    "RoutingReasonCode",
    "RoutingDecision",
    "CaseTag",
    "Tag",
    "CaseReadPosition",
    "MessageReceipt",
    "Message",
    "Session",
    "UserRole",
    "RolePermission",
    "Role",
    "Permission",
    "ExecutionBodyMember",
    "ExecutionBody",
    "Organization",
    "BeneficiaryPII",
    "Beneficiary",
    "Case",
    "User",
    "Tenant",
    "PolicyEvaluation",
  ];

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`,
  );
}
/* ============================================================
   LEDGER HELPER ledgerCommit
============================================================ */

async function ledgerCommit(
  tx: Prisma.TransactionClient,
  {
    tenantId,
    caseId,
    eventType,
    actorUserId,
    payload,
    supersedesCommitId,
  }: {
    tenantId: string;
    caseId: string;
    eventType: any;
    actorUserId?: string;
    payload: any;
    supersedesCommitId?: string;
  },
) {
  const ts = nextTs();

  // Canonical commitment payload
  const commitmentPayload = {
    tenantId,
    caseId,
    eventType,
    ts: ts.toString(),
    actorUserId: actorUserId ?? null,
    payload,
  };

  const commitmentHash = sha256(commitmentPayload);

  return tx.ledgerCommit.create({
    data: {
      tenantId,
      caseId,
      eventType,
      ts,
      actorKind: actorUserId ? "HUMAN" : "SYSTEM",
      actorUserId,
      authorityProof: "seed",
      commitmentHash,
      payload,
      supersedesCommitId,
    },
  });
}
/* ============================================================
   MAIN
============================================================ */

async function main() {
  await resetDatabase();

  await prisma.$transaction(async (tx) => {
    /* ================= TENANT ================= */

    const tenant = await tx.tenant.create({
      data: { slug: "ultra-demo", name: "Ultra Governance Tenant" },
    });

    /* ================= USERS ================= */

    const admin = await tx.user.create({
      data: { tenantId: tenant.id, email: "admin@ultra.local" },
    });

    const operator = await tx.user.create({
      data: { tenantId: tenant.id, email: "operator@ultra.local" },
    });

    const verifier = await tx.user.create({
      data: { tenantId: tenant.id, email: "verifier@ultra.local" },
    });

    /* ================= ORGS ================= */

    const donor = await tx.organization.create({
      data: { tenantId: tenant.id, name: "Global Health Fund" },
    });

    const implementer = await tx.organization.create({
      data: { tenantId: tenant.id, name: "Health Implementers Ltd" },
    });

    const executionBody = await tx.executionBody.create({
      data: {
        tenantId: tenant.id,
        orgId: implementer.id,
        capabilities: { sector: "health" },
      },
    });

    await tx.executionBodyMember.create({
      data: {
        tenantId: tenant.id,
        executionBodyId: executionBody.id,
        userId: operator.id,
      },
    });

    /* ============================================================
       CASE 1 — SUCCESSFUL FLOW resetDatabase
    ============================================================ */

    const beneficiary1 = await tx.beneficiary.create({
      data: { tenantId: tenant.id, displayName: faker.person.fullName() },
    });

    await tx.beneficiaryPII.create({
      data: { beneficiaryId: beneficiary1.id, phone: faker.phone.number() },
    });

    const case1 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        authorUserId: admin.id,
        beneficiaryId: beneficiary1.id,
        referenceCode: "ULTRA-CASE-001",
        mode: "AI_AUGMENTED",
        scope: "INTERNAL",
        type: "PROGRESS",
        lifecycle: "ROUTED",
        status: "ROUTED",
      },
    });

    const commitCreated = await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case1.id,
      eventType: "CASE_CREATED",
      actorUserId: admin.id,
      payload: { stage: "created" },
    });

    /* ROUTING */

    const routing = await tx.routingDecision.create({
      data: {
        tenantId: tenant.id,
        caseId: case1.id,
        routingOutcome: "MATCHED",
        chosenExecutionBodyId: executionBody.id,
        decidedByUserId: admin.id,
      },
    });

    await tx.counterfactualRecord.create({
      data: {
        tenantId: tenant.id,
        caseId: case1.id,
        routingDecisionId: routing.id,
        decisionType: "ROUTING",
        chosen: "HealthImplementers",
        constraintsApplied: ["sector=health"],
        alternatives: { fallback: false },
      },
    });

    await tx.caseAssignment.create({
      data: {
        caseId: case1.id,
        executionBodyId: executionBody.id,
        assignedByUserId: admin.id,
      },
    });

    await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case1.id,
      eventType: "ROUTED",
      actorUserId: admin.id,
      payload: { assigned: true },
    });

    /* EXECUTION */

    const execution = await tx.execution.create({
      data: {
        tenantId: tenant.id,
        caseId: case1.id,
        status: "IN_PROGRESS",
        startedByUserId: operator.id,
        startedAt: new Date(),
      },
    });

    await tx.executionProgress.create({
      data: {
        executionId: execution.id,
        label: "Delivery visit",
      },
    });

    await tx.execution.update({
      where: { id: execution.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case1.id,
      eventType: "EXECUTION_COMPLETED",
      actorUserId: operator.id,
      payload: { executionId: execution.id },
    });

    /* VERIFICATION */

    const verificationRecord = await tx.verificationRecord.create({
      data: {
        tenantId: tenant.id,
        caseId: case1.id,
        requiredVerifiers: 1,
        routedAt: new Date(),
      },
    });

    await tx.verification.create({
      data: {
        tenantId: tenant.id,
        verificationRecordId: verificationRecord.id,
        verifierUserId: verifier.id,
        status: "APPROVED",
      },
    });

    await tx.verificationRecord.update({
      where: { id: verificationRecord.id },
      data: {
        consensusReached: true,
        verifiedAt: new Date(),
      },
    });

    await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case1.id,
      eventType: "VERIFIED",
      actorUserId: verifier.id,
      payload: { verificationId: verificationRecord.id },
    });

    /* DISBURSEMENT SUCCESS */

    await tx.disbursement.create({
      data: {
        tenantId: tenant.id,
        caseId: case1.id,
        type: "PROVIDER_PAYMENT",
        status: "COMPLETED",
        amount: new Prisma.Decimal("2500"),
        currency: "USD",
        payeeKind: "ORG",
        payeeId: implementer.id,
        actorKind: "HUMAN",
        actorUserId: admin.id,
        authorityProof: "seed-proof",
        verificationRecordId: verificationRecord.id,
        executionId: execution.id,
        executedAt: new Date(),
      },
    });

    await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case1.id,
      eventType: "DISBURSEMENT_COMPLETED",
      actorUserId: admin.id,
      payload: { amount: 2500 },
    });

    /* ============================================================
       CASE 2 — FAILURE FLOW
    ============================================================ */

    const beneficiary2 = await tx.beneficiary.create({
      data: { tenantId: tenant.id, displayName: faker.person.fullName() },
    });

    const case2 = await tx.case.create({
      data: {
        tenantId: tenant.id,
        authorUserId: admin.id,
        beneficiaryId: beneficiary2.id,
        referenceCode: "ULTRA-CASE-002",
        mode: "ASSISTED",
        scope: "INTERNAL",
        type: "REQUEST",
        lifecycle: "ROUTED",
        status: "ROUTED",
      },
    });

    await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case2.id,
      eventType: "CASE_CREATED",
      actorUserId: admin.id,
      payload: { stage: "created" },
    });

    const execution2 = await tx.execution.create({
      data: {
        tenantId: tenant.id,
        caseId: case2.id,
        status: "ABORTED",
        startedByUserId: operator.id,
        startedAt: new Date(),
        abortedAt: new Date(),
      },
    });

    await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case2.id,
      eventType: "EXECUTION_ABORTED",
      actorUserId: operator.id,
      payload: { reason: "Delivery blocked" },
    });

    const failedVerification = await tx.verificationRecord.create({
      data: {
        tenantId: tenant.id,
        caseId: case2.id,
        requiredVerifiers: 1,
        routedAt: new Date(),
        consensusReached: false,
      },
    });

    await tx.disbursement.create({
      data: {
        tenantId: tenant.id,
        caseId: case2.id,
        type: "REIMBURSEMENT",
        status: "FAILED",
        amount: new Prisma.Decimal("1200"),
        currency: "USD",
        payeeKind: "BENEFICIARY",
        payeeId: beneficiary2.id,
        actorKind: "HUMAN",
        actorUserId: admin.id,
        authorityProof: "seed-proof",
        verificationRecordId: failedVerification.id,
        executionId: execution2.id,
        failedAt: new Date(),
        failureReason: "Verification incomplete",
      },
    });

    await ledgerCommit(tx, {
      tenantId: tenant.id,
      caseId: case2.id,
      eventType: "DISBURSEMENT_FAILED",
      actorUserId: admin.id,
      payload: { reason: "Verification incomplete" },
    });

    /* ================= GRANT ================= */

    const grant = await tx.grant.create({
      data: {
        tenantId: tenant.id,
        donorOrgId: donor.id,
        implementerOrgId: implementer.id,
        status: "ACTIVE",
        totalAmount: new Prisma.Decimal("50000"),
        activatedAt: new Date(),
      },
    });

    await tx.grantCase.create({
      data: { grantId: grant.id, caseId: case1.id },
    });

    await tx.budgetAllocation.create({
      data: {
        grantId: grant.id,
        category: "Operations",
        amount: new Prisma.Decimal("10000"),
      },
    });

    const tranche = await tx.tranche.create({
      data: {
        grantId: grant.id,
        sequence: 1,
        plannedPercent: new Prisma.Decimal("0.500"),
        status: "RELEASED",
        releasedAt: new Date(),
      },
    });

    await tx.trancheEvent.create({
      data: {
        trancheId: tranche.id,
        type: "RELEASE",
        payload: { amount: 25000 },
      },
    });
  });

  console.log("Production-grade realistic seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
