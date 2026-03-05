import { prisma } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * Ensures the input is valid JSON and compatible with Prisma JSON fields.
 */
function normalizeJson(input: unknown): Prisma.InputJsonValue | undefined {
  if (input === undefined) return undefined;

  try {
    return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
  } catch {
    throw new Error("Invalid JSON payload");
  }
}

/**
 * PolicyEvaluationService
 *
 * Records immutable policy evaluations.
 *
 * - version = policy version identifier (e.g. "v1")
 * - result  = decision output (authoritative evaluation result)
 * - context = evaluation input snapshot (optional, for replay/audit)
 *
 * This is NOT authority.
 * This is diagnostic truth for explainability and replay.
 */
export class PolicyEvaluationService {
  async record(params: {
    tenantId: string;
    caseId: string;
    policyKey: string;
    version: string;
    result: unknown;
    context?: unknown;
  }) {
    return prisma.policyEvaluation.create({
      data: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        policyKey: params.policyKey,
        version: params.version,

        result: normalizeJson(params.result) as Prisma.JsonObject,

        context:
          params.context === undefined
            ? undefined
            : normalizeJson(params.context),
      },
    });
  }
}
