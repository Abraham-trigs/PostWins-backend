import type { RoutingResult } from "./routing.types";
import { ensureKhalistarExecutionBody } from "../../../prisma/seed";

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
      reason: "MATCHED",
    };
  }

  const khalistar = await ensureKhalistarExecutionBody(tenantId);

  return {
    executionBodyId: khalistar.id,
    reason:
      candidateExecutionBodies.length === 0
        ? "FALLBACK_NO_MATCH"
        : "FALLBACK_WRONG_INTENT",
  };
}
