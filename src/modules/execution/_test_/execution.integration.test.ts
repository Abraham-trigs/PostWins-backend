// apps/backend/src/modules/execution/_test_/execution.integration.test.ts
// Integration test with fully valid multi-tenant seed (Tenant → User → Case → Execution)

import request from "supertest";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import app from "@/app";
import { prisma } from "@/lib/prisma";
import {
  CaseStatus,
  OperationalMode,
  AccessScope,
  CaseType,
} from "@prisma/client";

describe("Execution Workflow Integration", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const actorUserId = "22222222-2222-2222-2222-222222222222";

  let caseId: string;
  let milestoneId: string;

  beforeAll(async () => {
    // Cleanup in FK-safe order
    await prisma.executionMilestone.deleteMany({});
    await prisma.execution.deleteMany({});
    await prisma.case.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.tenant.deleteMany({});

    // 1️⃣ Seed Tenant
    await prisma.tenant.create({
      data: {
        id: tenantId,
        slug: "test-tenant",
        name: "Test Tenant",
      },
    });

    // 2️⃣ Seed User (author)
    await prisma.user.create({
      data: {
        id: actorUserId,
        tenantId,
        email: "test@example.com",
        name: "Test User",
      },
    });

    // 3️⃣ Seed Case
    const testCase = await prisma.case.create({
      data: {
        tenantId,
        authorUserId: actorUserId,
        mode: OperationalMode.MOCK,
        scope: AccessScope.INTERNAL,
        type: CaseType.EXECUTION,
        status: CaseStatus.INTAKED,
      },
    });

    caseId = testCase.id;
  });

  afterAll(async () => {
    await prisma.executionMilestone.deleteMany({});
    await prisma.execution.deleteMany({});
    await prisma.case.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.tenant.deleteMany({});
    await prisma.$disconnect();
  });

  it("should start execution", async () => {
    const res = await request(app)
      .post("/api/execution/start")
      .set("X-Tenant-Id", tenantId)
      .set("X-Actor-Id", actorUserId)
      .send({ caseId });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe("IN_PROGRESS");

    const execution = await prisma.execution.findUnique({
      where: { caseId },
      include: { milestones: true },
    });

    expect(execution).toBeDefined();
    expect(execution?.milestones.length).toBeGreaterThan(0);

    milestoneId = execution!.milestones[0].id;
  });

  it("should complete milestone idempotently", async () => {
    const res = await request(app)
      .post("/api/execution/milestones/complete")
      .set("X-Tenant-Id", tenantId)
      .set("X-Actor-Id", actorUserId)
      .set("Idempotency-Key", "ms-test-001")
      .send({ milestoneId });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.completedAt).toBeDefined();

    const repeat = await request(app)
      .post("/api/execution/milestones/complete")
      .set("X-Tenant-Id", tenantId)
      .set("X-Actor-Id", actorUserId)
      .set("Idempotency-Key", "ms-test-001")
      .send({ milestoneId });

    expect(repeat.status).toBe(200);
    expect(repeat.body.ok).toBe(true);
  });

  it("should derive progress correctly", async () => {
    const res = await request(app)
      .get(`/api/execution/${caseId}/progress`)
      .set("X-Tenant-Id", tenantId);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const progress = res.body.data;

    expect(progress.executionId).toBeDefined();
    expect(progress.totalWeight).toBeGreaterThan(0);
    expect(progress.completedWeight).toBeGreaterThanOrEqual(0);
    expect(progress.percent).toBeGreaterThanOrEqual(0);
  });
});

/* -------------------------------------------------------------------------------------------------
Design reasoning

Foreign keys require real parents.
Multi-tenant integrity demands Tenant and User exist before Case.

Integration tests must simulate full relational truth.

---------------------------------------------------------------------------------------------------
Structure

Tenant → User → Case → Execution → Milestone

FK-safe cleanup in reverse order.

---------------------------------------------------------------------------------------------------
Implementation guidance

If additional required relations are added:
Seed them in correct order.

For larger test suites:
Use a dedicated test DB or transaction rollback strategy.

---------------------------------------------------------------------------------------------------
Scalability insight

Never bypass foreign keys in tests.
They are your safety net.

If this fails:
It is protecting you.

Owner tomorrow:
The engineer maintaining domain integrity.
------------------------------------------------------------------------------------------------- */
