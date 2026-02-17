import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "dev" },
    update: {},
    create: {
      id: crypto.randomUUID(),
      slug: "dev",
      name: "Dev Tenant",
    },
  });

  const user = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: "admin@dev.local",
      },
    },
    update: { isActive: true, name: "Dev Admin" },
    create: {
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      email: "admin@dev.local",
      name: "Dev Admin",
      isActive: true,
    },
  });

  console.log("Seeded:");
  console.log("tenantId:", tenant.id);
  console.log("userId:", user.id);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

// import { PrismaClient } from "@prisma/client";
// import { KHALISTAR_ORG_KEY } from "../src/domain/system/systemActors";

// const prisma = new PrismaClient();

// export async function ensureKhalistarExecutionBody(tenantId: string) {
//   const org = await prisma.organization.upsert({
//     where: {
//       tenantId_key: {
//         tenantId,
//         key: KHALISTAR_ORG_KEY,
//       },
//     },
//     update: {},
//     create: {
//       tenantId,
//       key: KHALISTAR_ORG_KEY,
//       name: "Khalistar",
//       kind: "NGO",
//       executionBody: {
//         create: {
//           isFallback: true,
//           capabilities: {},
//         },
//       },
//     },
//     include: {
//       executionBody: true,
//     },
//   });

//   if (!org.executionBody) {
//     throw new Error(
//       "Invariant violation: Khalistar must have an execution body",
//     );
//   }

//   return org.executionBody;
// }
