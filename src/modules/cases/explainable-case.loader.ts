import { prisma } from "../../lib/prisma";

export class ExplainableCaseLoader {
  async load(params: { tenantId: string; caseId: string }) {
    const { tenantId, caseId } = params;

    const caseRow = await prisma.case.findFirst({
      where: { id: caseId, tenantId },
      include: {
        auditTrail: {
          orderBy: { createdAt: "asc" },
        },
        timelineEntries: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!caseRow) throw new Error("Case not found");

    const decisions = await prisma.decision.findMany({
      where: { tenantId, caseId },
      orderBy: { decidedAt: "asc" },
    });

    const authoritativeDecisions = decisions.filter(
      (d) => d.supersededAt === null,
    );

    const ledger = await prisma.ledgerCommit.findMany({
      where: { tenantId, caseId },
      orderBy: { ts: "asc" },
    });

    const policies = await prisma.policyEvaluation.findMany({
      where: { tenantId, caseId },
      orderBy: { evaluatedAt: "asc" },
    });

    return {
      case: caseRow,
      lifecycle: caseRow.lifecycle,

      authority: {
        active: authoritativeDecisions,
        history: decisions,
      },

      ledger,
      policies,
    };
  }
}
