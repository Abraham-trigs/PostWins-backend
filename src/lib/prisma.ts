// src/lib/prisma.ts
// Prisma client singleton with domain guard extensions and stable Transaction typing

import { PrismaClient } from "@prisma/client";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClientType | undefined;
}

////////////////////////////////////////////////////////////////
// Prisma Base Client
////////////////////////////////////////////////////////////////

const basePrisma = new PrismaClient({
  log: ["error", "warn"],
});

////////////////////////////////////////////////////////////////
// Domain Guard Extensions
////////////////////////////////////////////////////////////////
//
// DOMAIN INVARIANTS (DO NOT VIOLATE):
// - Case.lifecycle is AUTHORITATIVE and governed by transition helpers
// - Case.status is advisory / derived (UI + ops only)
// - RoutingOutcome is decision metadata, not lifecycle
//
// IMPORTANT:
// Lifecycle mutation enforcement is handled at the domain layer
// (transitionCaseLifecycleWithLedger). We no longer warn at ORM level
// because Prisma middleware cannot reliably distinguish authorized writes.
//
////////////////////////////////////////////////////////////////

const prismaWithGuards = basePrisma.$extends({
  query: {
    case: {
      async update({ args, query }) {
        warnOnCaseAdvisoryWrite(args.data);
        return query(args);
      },
      async updateMany({ args, query }) {
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
// Case.status Guard (Advisory Field)
////////////////////////////////////////////////////////////////
//
// Case.status must be derived from Case.lifecycle.
// Direct writes are discouraged.
//
////////////////////////////////////////////////////////////////

function warnOnCaseAdvisoryWrite(data: unknown) {
  if (!data || typeof data !== "object") return;

  const keys = Object.keys(data as Record<string, unknown>);

  if (keys.includes("status")) {
    console.warn(
      "[domain-warning] Direct write to Case.status detected.",
      "Case.status is NON-AUTHORITATIVE and must be derived from Case.lifecycle.",
      "Use deriveCaseStatus(...) and centralized helpers.",
    );
  }
}

////////////////////////////////////////////////////////////////
// RoutingOutcome Guard
////////////////////////////////////////////////////////////////
//
// RoutingOutcome is decision metadata, not lifecycle state.
//
////////////////////////////////////////////////////////////////

function warnOnRoutingOutcomeWrite(data: unknown) {
  if (!data || typeof data !== "object") return;

  const keys = Object.keys(data as Record<string, unknown>);

  if (keys.includes("routingOutcome")) {
    console.warn(
      "[domain-warning] Direct write to RoutingDecision.routingOutcome detected.",
      "RoutingOutcome is decision metadata, not lifecycle state.",
    );
  }
}

////////////////////////////////////////////////////////////////
// Prisma Singleton Export
////////////////////////////////////////////////////////////////
//
// $extends() changes inferred type and breaks transaction overloads.
// We cast back to PrismaClientType for stability.
//
////////////////////////////////////////////////////////////////

export const prisma: PrismaClientType =
  (globalThis.prisma as PrismaClientType | undefined) ??
  (prismaWithGuards as unknown as PrismaClientType);

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
