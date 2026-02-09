import { prisma } from "../../lib/prisma";

export class PolicyEvaluationService {
  async record(params: {
    tenantId: string;
    caseId: string;
    policyKey: string;
    version: string;
    result: unknown;
  }) {
    return prisma.policyEvaluation.create({
      data: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        policyKey: params.policyKey,
        outcome: params.version,
        context: params.result,
      },
    });
  }
}
