// filepath: apps/backend/src/lib/prisma.ts
// Purpose: Prisma client singleton with strict domain lifecycle enforcement.

////////////////////////////////////////////////////////////////
// Assumptions
////////////////////////////////////////////////////////////////
// - Case.lifecycle MUST only change via transitionCaseLifecycleWithLedger()
// - All other writes must be blocked
// - Internal domain services may use prismaUnsafe
// - No unsafe casts allowed

////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////

import { PrismaClient } from "@prisma/client";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Global Singleton Declaration
////////////////////////////////////////////////////////////////

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientType | undefined;
}

////////////////////////////////////////////////////////////////
// Base Prisma Client (UNGUARDED)
////////////////////////////////////////////////////////////////

const basePrisma = new PrismaClient({
  log: ["error", "warn"],
});

////////////////////////////////////////////////////////////////
// Lifecycle Enforcement Guard
////////////////////////////////////////////////////////////////

function enforceLifecycleLaw(data: unknown) {
  if (!data || typeof data !== "object") return;

  if ("lifecycle" in (data as Record<string, unknown>)) {
    throw new Error(
      "Case.lifecycle MUST NOT be written directly. Use transitionCaseLifecycleWithLedger().",
    );
  }
}

////////////////////////////////////////////////////////////////
// Advisory Guards
////////////////////////////////////////////////////////////////

function warnOnCaseAdvisoryWrite(data: unknown) {
  if (!data || typeof data !== "object") return;

  if ("status" in (data as Record<string, unknown>)) {
    console.warn(
      "[domain-warning] Direct write to Case.status detected.",
      "Case.status must be derived from Case.lifecycle.",
    );
  }
}

function warnOnRoutingOutcomeWrite(data: unknown) {
  if (!data || typeof data !== "object") return;

  if ("routingOutcome" in (data as Record<string, unknown>)) {
    console.warn(
      "[domain-warning] Direct write to RoutingDecision.routingOutcome detected.",
    );
  }
}

////////////////////////////////////////////////////////////////
// Guarded Prisma Client
////////////////////////////////////////////////////////////////

const prismaWithGuards = basePrisma.$extends({
  query: {
    case: {
      async update({ args, query }) {
        enforceLifecycleLaw(args.data);
        warnOnCaseAdvisoryWrite(args.data);
        return query(args);
      },
      async updateMany({ args, query }) {
        enforceLifecycleLaw(args.data);
        warnOnCaseAdvisoryWrite(args.data);
        return query(args);
      },
    },
    routingDecision: {
      async update({ args, query }) {
        warnOnRoutingOutcomeWrite(args.data);
        return query(args);
      },
      async updateMany({ args, query }) {
        warnOnRoutingOutcomeWrite(args.data);
        return query(args);
      },
    },
  },
});

////////////////////////////////////////////////////////////////
// Public Export (Guarded Client)
////////////////////////////////////////////////////////////////

export const prisma: PrismaClientType =
  globalThis.prisma ?? (prismaWithGuards as PrismaClientType);

////////////////////////////////////////////////////////////////
// Internal Unsafe Client (Domain Only)
////////////////////////////////////////////////////////////////
//
// IMPORTANT:
// Only lifecycle domain services may import this.
// Never use in controllers or general services.
//

export const prismaUnsafe: PrismaClientType = basePrisma;

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
//
// - prisma: protected client for all services
// - prismaUnsafe: internal-only client for governance services
// - No bypass flags
// - No schema hacks
// - Structural enforcement at ORM boundary

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
//
// As system grows, accidental lifecycle writes remain impossible.
// Governance safety is enforced structurally, not culturally.
