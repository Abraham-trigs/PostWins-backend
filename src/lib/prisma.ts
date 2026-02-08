import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

/**
 * Prisma client singleton.
 *
 * DOMAIN INVARIANTS (DO NOT VIOLATE):
 * - Case.lifecycle is the ONLY authoritative state
 * - Case.lifecycle must be mutated via transition helpers
 * - Case.status is advisory / derived (UI + ops only)
 * - RoutingOutcome is decision metadata, not lifecycle
 *
 * This client WARNs (does not block) on invariant violations.
 */
const basePrisma = new PrismaClient({
  log: ["error", "warn"],
});

const prismaWithGuards = basePrisma.$extends({
  query: {
    case: {
      async update({ args, query }) {
        warnOnCaseLifecycleWrite(args.data);
        warnOnCaseAdvisoryWrite(args.data);
        return query(args);
      },
      async updateMany({ args, query }) {
        warnOnCaseLifecycleWrite(args.data);
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

function warnOnCaseLifecycleWrite(data: unknown) {
  if (!data || typeof data !== "object") return;

  const keys = Object.keys(data as Record<string, unknown>);

  if (keys.includes("lifecycle")) {
    console.warn(
      "[domain-warning] Direct write to Case.lifecycle detected.",
      "Case.lifecycle is AUTHORITATIVE and must be changed via transition helpers.",
      "Use transitionCaseLifecycle(...) or transitionCaseLifecycleWithLedger(...).",
    );
  }
}

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

export const prisma = globalThis.prisma ?? prismaWithGuards;

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
