// apps/backend/prisma/seed.ts
/**
 * Purpose:
 * Production-grade structured seed script generating:
 * - Single tenant
 * - Roles & permissions
 * - Organizations + ExecutionBody
 * - Active Grant + allocations + tranches
 * - Foundation helpers for full lifecycle case simulation (Part 2)
 *
 * Design reasoning:
 * This seed mirrors real lifecycle flow instead of flat fixtures.
 * We structure helpers for deterministic, relationally consistent
 * generation across Case → Routing → Execution → Verification →
 * Disbursement → Ledger.
 *
 * Structure:
 * - Imports
 * - Constants
 * - Core helpers
 * - Role + Permission seed
 * - Organization + ExecutionBody seed
 * - Grant + Budget + Tranche seed
 * - Exports seed context
 *
 * Implementation guidance:
 * This file runs via `prisma db seed`.
 * It assumes DATABASE_URL is configured and schema migrated.
 *
 * Scalability insight:
 * Lifecycle simulation logic is isolated so increasing from
 * 50 → 500 cases is a single constant change.
 */

import crypto from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

////////////////////////////////////////////////////////////////
// CONFIG
////////////////////////////////////////////////////////////////

const CASE_COUNT = 50;

////////////////////////////////////////////////////////////////
// HELPERS
////////////////////////////////////////////////////////////////

const now = () => new Date();

function uuid() {
  return crypto.randomUUID();
}

function randomAmount(min = 50, max = 500) {
  return new Prisma.Decimal(faker.number.int({ min, max }).toFixed(2));
}

function randomCurrency() {
  return "USD";
}

////////////////////////////////////////////////////////////////
// TENANT
////////////////////////////////////////////////////////////////

async function seedTenant() {
  return prisma.tenant.upsert({
    where: { slug: "dev" },
    update: {},
    create: {
      id: uuid(),
      slug: "dev",
      name: "Dev Tenant",
    },
  });
}

////////////////////////////////////////////////////////////////
// ROLES + PERMISSIONS
////////////////////////////////////////////////////////////////

const BASE_PERMISSIONS = [
  "CASE_CREATE",
  "CASE_ROUTE",
  "CASE_ACCEPT",
  "CASE_EXECUTE",
  "CASE_VERIFY",
  "CASE_DISBURSE",
  "GRANT_MANAGE",
];

async function seedRoles(tenantId: string) {
  const permissions = await Promise.all(
    BASE_PERMISSIONS.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: {
          id: uuid(),
          key,
          name: key,
        },
      }),
    ),
  );

  async function createRole(key: string, name: string, permKeys: string[]) {
    const role = await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: {},
      create: {
        id: uuid(),
        tenantId,
        key,
        name,
      },
    });

    await Promise.all(
      permissions
        .filter((p) => permKeys.includes(p.key))
        .map((perm) =>
          prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId: perm.id,
              },
            },
            update: {},
            create: {
              id: uuid(),
              roleId: role.id,
              permissionId: perm.id,
            },
          }),
        ),
    );

    return role;
  }

  const admin = await createRole("ADMIN", "Administrator", BASE_PERMISSIONS);
  const verifier = await createRole("VERIFIER", "Verifier", ["CASE_VERIFY"]);
  const executor = await createRole("EXECUTOR", "Executor", ["CASE_EXECUTE"]);

  return { admin, verifier, executor };
}

////////////////////////////////////////////////////////////////
// USERS
////////////////////////////////////////////////////////////////

async function seedUsers(
  tenantId: string,
  roles: Awaited<ReturnType<typeof seedRoles>>,
) {
  const admin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId,
        email: "admin@dev.local",
      },
    },
    update: {},
    create: {
      id: uuid(),
      tenantId,
      email: "admin@dev.local",
      name: "Dev Admin",
      isActive: true,
    },
  });

  await prisma.userRole
    .create({
      data: {
        id: uuid(),
        userId: admin.id,
        roleId: roles.admin.id,
      },
    })
    .catch(() => {});

  const verifiers = await Promise.all(
    Array.from({ length: 3 }).map(async () => {
      const user = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          email: faker.internet.email(),
          name: faker.person.fullName(),
          isActive: true,
        },
      });

      await prisma.userRole.create({
        data: {
          id: uuid(),
          userId: user.id,
          roleId: roles.verifier.id,
        },
      });

      return user;
    }),
  );

  const executors = await Promise.all(
    Array.from({ length: 3 }).map(async () => {
      const user = await prisma.user.create({
        data: {
          id: uuid(),
          tenantId,
          email: faker.internet.email(),
          name: faker.person.fullName(),
          isActive: true,
        },
      });

      await prisma.userRole.create({
        data: {
          id: uuid(),
          userId: user.id,
          roleId: roles.executor.id,
        },
      });

      return user;
    }),
  );

  return { admin, verifiers, executors };
}

////////////////////////////////////////////////////////////////
// ORGANIZATIONS + EXECUTION BODY
////////////////////////////////////////////////////////////////

async function seedOrganizations(tenantId: string) {
  const donor = await prisma.organization.create({
    data: {
      id: uuid(),
      tenantId,
      name: "Global Development Fund",
    },
  });

  const implementer = await prisma.organization.create({
    data: {
      id: uuid(),
      tenantId,
      name: "Community Implementation Org",
    },
  });

  const executionBody = await prisma.executionBody.create({
    data: {
      id: uuid(),
      tenantId,
      orgId: implementer.id,
      capabilities: { programs: ["education", "health", "housing"] },
      isFallback: true,
    },
  });

  return { donor, implementer, executionBody };
}

////////////////////////////////////////////////////////////////
// GRANT + BUDGET + TRANCHES
////////////////////////////////////////////////////////////////

async function seedGrant(
  tenantId: string,
  donorOrgId: string,
  implementerOrgId: string,
) {
  const totalAmount = new Prisma.Decimal(50000);

  const grant = await prisma.grant.create({
    data: {
      id: uuid(),
      tenantId,
      donorOrgId,
      implementerOrgId,
      status: "ACTIVE",
      currency: "USD",
      totalAmount,
      activatedAt: now(),
    },
  });

  await prisma.budgetAllocation.createMany({
    data: [
      {
        id: uuid(),
        grantId: grant.id,
        category: "Education",
        amount: new Prisma.Decimal(20000),
      },
      {
        id: uuid(),
        grantId: grant.id,
        category: "Health",
        amount: new Prisma.Decimal(15000),
      },
      {
        id: uuid(),
        grantId: grant.id,
        category: "Housing",
        amount: new Prisma.Decimal(15000),
      },
    ],
  });

  await prisma.tranche.createMany({
    data: [
      {
        id: uuid(),
        grantId: grant.id,
        sequence: 1,
        plannedPercent: new Prisma.Decimal(0.25),
        status: "RELEASED",
        releasedAt: now(),
      },
      {
        id: uuid(),
        grantId: grant.id,
        sequence: 2,
        plannedPercent: new Prisma.Decimal(0.25),
      },
      {
        id: uuid(),
        grantId: grant.id,
        sequence: 3,
        plannedPercent: new Prisma.Decimal(0.25),
      },
      {
        id: uuid(),
        grantId: grant.id,
        sequence: 4,
        plannedPercent: new Prisma.Decimal(0.25),
      },
    ],
  });

  return grant;
}

////////////////////////////////////////////////////////////////
// EXPORT CONTEXT FOR PART 2
////////////////////////////////////////////////////////////////

export async function seedBase() {
  const tenant = await seedTenant();
  const roles = await seedRoles(tenant.id);
  const users = await seedUsers(tenant.id, roles);
  const orgs = await seedOrganizations(tenant.id);
  const grant = await seedGrant(tenant.id, orgs.donor.id, orgs.implementer.id);

  return {
    tenant,
    roles,
    users,
    orgs,
    grant,
  };
}

////////////////////////////////////////////////////////////////
// FULL LIFECYCLE SIMULATION (50 CASES)
////////////////////////////////////////////////////////////////

async function simulateCases(context: Awaited<ReturnType<typeof seedBase>>) {
  const { tenant, users, orgs, grant } = context;

  for (let i = 0; i < CASE_COUNT; i++) {
    await prisma.$transaction(async (tx) => {
      //////////////////////////////////////////////////////////////////
      // BENEFICIARY
      //////////////////////////////////////////////////////////////////
      const beneficiary = await tx.beneficiary.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          displayName: faker.person.fullName(),
        },
      });

      //////////////////////////////////////////////////////////////////
      // CASE INTAKE
      //////////////////////////////////////////////////////////////////
      const caseEntity = await tx.case.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          authorUserId: users.admin.id,
          beneficiaryId: beneficiary.id,
          mode: "ASSISTED",
          scope: "INTERNAL",
          type: "EXECUTION",
          summary: faker.lorem.sentence(),
          sdgGoal: "SDG-" + faker.number.int({ min: 1, max: 17 }),
          status: "INTAKED",
        },
      });

      //////////////////////////////////////////////////////////////////
      // GRANT LINK
      //////////////////////////////////////////////////////////////////
      await tx.grantCase.create({
        data: {
          id: uuid(),
          grantId: grant.id,
          caseId: caseEntity.id,
        },
      });

      //////////////////////////////////////////////////////////////////
      // ROUTING DECISION
      //////////////////////////////////////////////////////////////////
      const routing = await tx.routingDecision.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          routingOutcome: "MATCHED",
          chosenExecutionBodyId: orgs.executionBody.id,
        },
      });

      //////////////////////////////////////////////////////////////////
      // ASSIGNMENT
      //////////////////////////////////////////////////////////////////
      await tx.caseAssignment.create({
        data: {
          id: uuid(),
          caseId: caseEntity.id,
          executionBodyId: orgs.executionBody.id,
          assignedByUserId: users.admin.id,
        },
      });

      //////////////////////////////////////////////////////////////////
      // EXECUTION
      //////////////////////////////////////////////////////////////////
      const execution = await tx.execution.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          status: "IN_PROGRESS",
          startedAt: now(),
          startedByUserId:
            users.executors[faker.number.int({ min: 0, max: 2 })].id,
        },
      });

      //////////////////////////////////////////////////////////////////
      // MILESTONES
      //////////////////////////////////////////////////////////////////
      const milestones = ["Enrollment", "Delivery", "Completion"];

      for (const label of milestones) {
        await tx.executionMilestone.create({
          data: {
            id: uuid(),
            executionId: execution.id,
            label,
            completedAt: now(),
            completedByUserId:
              users.executors[faker.number.int({ min: 0, max: 2 })].id,
          },
        });
      }

      //////////////////////////////////////////////////////////////////
      // COMPLETE EXECUTION
      //////////////////////////////////////////////////////////////////
      await tx.execution.update({
        where: { id: execution.id },
        data: {
          status: "COMPLETED",
          completedAt: now(),
        },
      });

      //////////////////////////////////////////////////////////////////
      // VERIFICATION RECORD
      //////////////////////////////////////////////////////////////////
      const verificationRecord = await tx.verificationRecord.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          requiredVerifiers: 2,
          routedAt: now(),
        },
      });

      //////////////////////////////////////////////////////////////////
      // VERIFICATIONS
      //////////////////////////////////////////////////////////////////
      for (let v = 0; v < 2; v++) {
        await tx.verification.create({
          data: {
            id: uuid(),
            tenantId: tenant.id,
            verificationRecordId: verificationRecord.id,
            verifierUserId: users.verifiers[v].id,
            status: "APPROVED",
          },
        });
      }

      await tx.verificationRecord.update({
        where: { id: verificationRecord.id },
        data: {
          consensusReached: true,
          verifiedAt: now(),
        },
      });

      //////////////////////////////////////////////////////////////////
      // DECISION SNAPSHOT
      //////////////////////////////////////////////////////////////////
      await tx.decision.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          decisionType: "VERIFICATION",
          actorKind: "HUMAN",
          actorUserId: users.verifiers[0].id,
          reason: "Consensus reached",
        },
      });

      //////////////////////////////////////////////////////////////////
      // DISBURSEMENT
      //////////////////////////////////////////////////////////////////
      const disbursement = await tx.disbursement.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          type: "BENEFICIARY_PAYMENT",
          status: "COMPLETED",
          amount: randomAmount(),
          currency: randomCurrency(),
          payeeKind: "BENEFICIARY",
          payeeId: beneficiary.id,
          actorKind: "HUMAN",
          actorUserId: users.admin.id,
          authorityProof: "SEED-AUTH",
          verificationRecordId: verificationRecord.id,
          executionId: execution.id,
          executedAt: now(),
        },
      });

      //////////////////////////////////////////////////////////////////
      // LEDGER COMMIT
      //////////////////////////////////////////////////////////////////
      await tx.ledgerCommit.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          eventType: "DISBURSEMENT_COMPLETED",
          ts: BigInt(Date.now() * 1000 + i),
          actorKind: "HUMAN",
          actorUserId: users.admin.id,
          authorityProof: "SEED",
          commitmentHash: crypto
            .createHash("sha256")
            .update(disbursement.id)
            .digest("hex"),
          payload: {
            disbursementId: disbursement.id,
          },
        },
      });

      //////////////////////////////////////////////////////////////////
      // TIMELINE ENTRY
      //////////////////////////////////////////////////////////////////
      const timeline = await tx.timelineEntry.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          type: "DELIVERY",
          body: "Service delivered successfully",
        },
      });

      await tx.evidence.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          timelineEntryId: timeline.id,
          kind: "PHOTO",
          storageKey: faker.system.fileName(),
          sha256: crypto.createHash("sha256").update(timeline.id).digest("hex"),
        },
      });

      //////////////////////////////////////////////////////////////////
      // AUDIT ENTRY
      //////////////////////////////////////////////////////////////////
      await tx.auditEntry.create({
        data: {
          id: uuid(),
          tenantId: tenant.id,
          caseId: caseEntity.id,
          actorLabel: "SYSTEM_SEED",
          note: "Lifecycle simulated",
        },
      });
    });
  }
}

////////////////////////////////////////////////////////////////
// MAIN
////////////////////////////////////////////////////////////////

async function main() {
  console.log("Seeding lifecycle graph...");

  const base = await seedBase();

  await simulateCases(base);

  console.log(`Seeded ${CASE_COUNT} full lifecycle cases.`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

////////////////////////////////////////////////////////////////
// DESIGN SUMMARY
////////////////////////////////////////////////////////////////

/**
Design reasoning:
This seed mirrors real-world state transitions instead of flat fixtures.
Each case passes through routing, assignment, execution,
verification, decision snapshot, disbursement, ledger commit,
timeline, and audit entry — enforcing relational correctness.

Structure:
- seedBase(): infrastructure (tenant, roles, orgs, grant)
- simulateCases(): lifecycle graph per case
- main(): orchestrator

Implementation guidance:
Run:
  pnpm prisma db seed
after migrations.
Ensure pgcrypto extension enabled.

Scalability insight:
Increase CASE_COUNT to scale dataset.
All writes are transactional per case to preserve integrity.
*/
