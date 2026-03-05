// apps/backend/src/modules/routing/computeRouting.ts
// Pure deterministic routing engine.

import { RoutingOutcome } from "@prisma/client";
import type { RoutingResult } from "./routing.types";

export function computeRouting({
  intentCode,
  originExecutionBodyId,
  candidateExecutionBodies,
  fallbackExecutionBodyId,
}: {
  intentCode: string;
  originExecutionBodyId?: string;
  candidateExecutionBodies: Array<{
    id: string;
    supportsIntent: (intentCode: string) => boolean;
  }>;
  fallbackExecutionBodyId?: string;
}): RoutingResult {
  ////////////////////////////////////////////////////////////////
  // 1️⃣ Deterministic ordering
  ////////////////////////////////////////////////////////////////

  const sorted = [...candidateExecutionBodies].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const byId = new Map(sorted.map((b) => [b.id, b]));

  const origin = originExecutionBodyId
    ? byId.get(originExecutionBodyId)
    : undefined;

  ////////////////////////////////////////////////////////////////
  // 2️⃣ Prefer originator if capable
  ////////////////////////////////////////////////////////////////

  if (origin && origin.supportsIntent(intentCode)) {
    return {
      executionBodyId: origin.id,
      outcome: RoutingOutcome.MATCHED,
      reason: "ORIGINATOR_CAPABLE",
    };
  }

  ////////////////////////////////////////////////////////////////
  // 3️⃣ Attempt normal capability match
  ////////////////////////////////////////////////////////////////

  const matched = sorted.find((b) => b.supportsIntent(intentCode));

  if (matched) {
    return {
      executionBodyId: matched.id,
      outcome: RoutingOutcome.MATCHED,
      reason: "MATCHED",
    };
  }

  ////////////////////////////////////////////////////////////////
  // 4️⃣ Fallback logic
  ////////////////////////////////////////////////////////////////

  if (!fallbackExecutionBodyId) {
    throw new Error("ROUTING_UNASSIGNABLE_NO_FALLBACK");
  }

  return {
    executionBodyId: fallbackExecutionBodyId,
    outcome: RoutingOutcome.FALLBACK,
    reason:
      sorted.length === 0 ? "FALLBACK_NO_CANDIDATES" : "FALLBACK_NO_MATCH",
  };
}
