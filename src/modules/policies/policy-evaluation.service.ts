import { prisma } from "../../lib/prisma";

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
    context?: unknown; // ← matches schema Json?
  }) {
    return prisma.policyEvaluation.create({
      data: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        policyKey: params.policyKey,
        version: params.version, // ✅ matches schema
        result: params.result as any, // ✅ Json
        context: params.context as any, // ✅ Json?
      },
    });
  }
}
