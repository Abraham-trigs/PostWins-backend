// src/modules/cases/case-ref.resolver.ts
// Resolves CaseRef objects into authoritative caseId using decision + ledger models (PolicyEvaluation removed)

import { prisma } from "../../lib/prisma";
import { CaseRef } from "./case-ref";
import { ResolverError, CaseNotFoundError } from "./case.errors";

export class CaseRefResolver {
  async resolve(ref: CaseRef, tenantId: string): Promise<{ caseId: string }> {
    switch (ref.kind) {
      ////////////////////////////////////////////////////////////////
      // Direct case reference
      ////////////////////////////////////////////////////////////////
      case "CASE": {
        const exists = await prisma.case.findFirst({
          where: { id: ref.id, tenantId },
          select: { id: true },
        });

        if (!exists) {
          throw new CaseNotFoundError(ref.id);
        }

        return { caseId: ref.id };
      }

      ////////////////////////////////////////////////////////////////
      // Decision reference
      ////////////////////////////////////////////////////////////////
      case "DECISION": {
        const decision = await prisma.decision.findFirst({
          where: { id: ref.id, tenantId },
          select: { caseId: true },
        });

        if (!decision) {
          throw new ResolverError("Decision not found");
        }

        return { caseId: decision.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // POLICY reference (migrated from PolicyEvaluation table)
      // Now resolved via latest decision with matching policyKey
      ////////////////////////////////////////////////////////////////
      case "POLICY": {
        const decision = await prisma.decision.findFirst({
          where: {
            tenantId,
            intentContext: {
              path: ["policyKey"],
              equals: ref.policyKey,
            },
          },
          orderBy: { decidedAt: "desc" },
          select: { caseId: true },
        });

        if (!decision) {
          throw new ResolverError("Policy reference not found");
        }

        return { caseId: decision.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // Ledger reference
      ////////////////////////////////////////////////////////////////
      case "LEDGER": {
        const commit = await prisma.ledgerCommit.findFirst({
          where: { id: ref.id, tenantId },
          select: { caseId: true },
        });

        if (!commit?.caseId) {
          throw new ResolverError("Ledger reference not found");
        }

        return { caseId: commit.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // TAG reference (migrated from PolicyEvaluation table)
      // Now resolved via decision.intentContext string search
      ////////////////////////////////////////////////////////////////
      case "TAG": {
        const decision = await prisma.decision.findFirst({
          where: {
            tenantId,
            intentContext: {
              string_contains: ref.value,
            },
          },
          orderBy: { decidedAt: "desc" },
          select: { caseId: true },
        });

        if (!decision) {
          throw new ResolverError("Tag reference not found");
        }

        return { caseId: decision.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // Unsupported ref
      ////////////////////////////////////////////////////////////////
      default:
        throw new ResolverError("Unsupported CaseRef");
    }
  }
}
