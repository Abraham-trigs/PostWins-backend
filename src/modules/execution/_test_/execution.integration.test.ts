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
import crypto from "node:crypto";

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

    // 3️⃣ Seed Case (aligned with updated schema)
    const testCase = await prisma.case.create({
      data: {
        id: crypto.randomUUID(), // Explicit primary key
        referenceCode: crypto.randomUUID(), // REQUIRED by schema
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

Schema now requires referenceCode and explicit id alignment.
Tests must mirror production invariants to avoid drift.

---------------------------------------------------------------------------------------------------
Structure

Tenant → User → Case (with id + referenceCode) → Execution → Milestone

---------------------------------------------------------------------------------------------------
Implementation guidance

If Case model changes again:
Update seed block immediately.
Never rely on implicit defaults when schema is strict.

---------------------------------------------------------------------------------------------------
Scalability insight

Schema strictness in tests prevents silent production bugs.
If this compiles, your model alignment is correct.
------------------------------------------------------------------------------------------------- */
