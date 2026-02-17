import type { RoutingResult } from "./routing.types";
import { prisma } from "@/lib/prisma";

export async function routeCase({
  tenantId,
  intentCode,
  candidateExecutionBodies,
}: {
  tenantId: string;
  intentCode: string;
  candidateExecutionBodies: Array<{
    id: string;
    supportsIntent: (intentCode: string) => boolean;
  }>;
}): Promise<RoutingResult> {
  const matched = candidateExecutionBodies.find((b) =>
    b.supportsIntent(intentCode),
  );

  if (matched) {
    return {
      executionBodyId: matched.id,
      outcome: "MATCHED",
      reason: "MATCHED",
    };
  }

  /**
   * Fallback resolution must not depend on seed logic.
   * We resolve the canonical fallback execution body directly from DB.
   */
  const khalistar = await prisma.executionBody.findFirst({
    where: {
      tenantId,
      isFallback: true,
    },
    select: { id: true },
  });

  if (!khalistar) {
    throw new Error(`Fallback execution body not found for tenant ${tenantId}`);
  }

  return {
    executionBodyId: khalistar.id,
    outcome: candidateExecutionBodies.length === 0 ? "UNASSIGNED" : "FALLBACK",
    reason:
      candidateExecutionBodies.length === 0
        ? "FALLBACK_NO_MATCH"
        : "FALLBACK_WRONG_INTENT",
  };
}
