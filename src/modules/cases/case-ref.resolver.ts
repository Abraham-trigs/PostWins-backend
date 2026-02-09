import { prisma } from "../../lib/prisma";
import { CaseRef } from "./case-ref";

export class CaseRefResolver {
  async resolve(ref: CaseRef, tenantId: string): Promise<{ caseId: string }> {
    switch (ref.kind) {
      case "CASE": {
        const exists = await prisma.case.findFirst({
          where: { id: ref.id, tenantId },
          select: { id: true },
        });
        if (!exists) throw new Error("Case not found");
        return { caseId: ref.id };
      }

      case "DECISION": {
        const decision = await prisma.decision.findFirst({
          where: { id: ref.id, tenantId },
          select: { caseId: true },
        });
        if (!decision) throw new Error("Decision not found");
        return { caseId: decision.caseId };
      }

      case "POLICY": {
        const evalRow = await prisma.policyEvaluation.findFirst({
          where: { policyKey: ref.policyKey, tenantId },
          orderBy: { evaluatedAt: "desc" },
          select: { caseId: true },
        });
        if (!evalRow) throw new Error("Policy reference not found");
        return { caseId: evalRow.caseId };
      }

      case "LEDGER": {
        const commit = await prisma.ledgerCommit.findFirst({
          where: { id: ref.id, tenantId },
          select: { caseId: true },
        });
        if (!commit?.caseId) throw new Error("Ledger reference not found");
        return { caseId: commit.caseId };
      }

      case "TAG": {
        const evalRow = await prisma.policyEvaluation.findFirst({
          where: {
            tenantId,
            policyKey: { contains: ref.value },
          },
          orderBy: { evaluatedAt: "desc" },
          select: { caseId: true },
        });
        if (!evalRow) throw new Error("Tag reference not found");
        return { caseId: evalRow.caseId };
      }

      default:
        throw new Error("Unsupported CaseRef");
    }
  }
}
