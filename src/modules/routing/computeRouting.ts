// apps/backend/src/modules/routing/computeRouting.ts
// Pure deterministic routing engine.

import { RoutingOutcome } from "@prisma/client";
import type { RoutingResult } from "./routing.types";

export function computeRouting({
  intentCode,
  candidateExecutionBodies,
  fallbackExecutionBodyId,
}: {
  intentCode: string;
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

  ////////////////////////////////////////////////////////////////
  // 2️⃣ Attempt match
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
  // 3️⃣ Fallback logic
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
