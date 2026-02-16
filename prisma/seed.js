"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureKhalistarExecutionBody = ensureKhalistarExecutionBody;
const node_crypto_1 = __importDefault(require("node:crypto"));
async function main() {
    const tenant = await prisma.tenant.upsert({
        where: { slug: "dev" },
        update: {},
        create: {
            id: node_crypto_1.default.randomUUID(),
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
            id: node_crypto_1.default.randomUUID(),
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
const client_1 = require("@prisma/client");
const systemActors_1 = require("../src/domain/system/systemActors");
const prisma = new client_1.PrismaClient();
async function ensureKhalistarExecutionBody(tenantId) {
    const org = await prisma.organization.upsert({
        where: {
            tenantId_key: {
                tenantId,
                key: systemActors_1.KHALISTAR_ORG_KEY,
            },
        },
        update: {},
        create: {
            tenantId,
            key: systemActors_1.KHALISTAR_ORG_KEY,
            name: "Khalistar",
            kind: "NGO",
            executionBody: {
                create: {
                    isFallback: true,
                    capabilities: {},
                },
            },
        },
        include: {
            executionBody: true,
        },
    });
    if (!org.executionBody) {
        throw new Error("Invariant violation: Khalistar must have an execution body");
    }
    return org.executionBody;
}
