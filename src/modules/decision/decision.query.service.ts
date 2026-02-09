import { prisma } from "../../lib/prisma";
import { DecisionType } from "@prisma/client";
import { DecisionExplanation } from "./decision.types";

/**
 * Phase 5 — Decision Explainability & Audit Queries
 *
 * Read-only. Deterministic. No inference.
 * These queries explain authority, history, and facts.
 */
export class DecisionQueryService {
  /**
   * Internal mapper — explicit and boring by design.
   */
  private toDecisionExplanation(decision: any): DecisionExplanation {
    return {
      decisionId: decision.id,
      decisionType: decision.decisionType,
      authoritative: decision.supersededAt === null,
      supersededAt: decision.supersededAt ?? undefined,
      actorKind: decision.actorKind,
      actorUserId: decision.actorUserId ?? undefined,
      decidedAt: decision.decidedAt,
      reason: decision.reason ?? undefined,
      intentContext: decision.intentContext ?? undefined,
    };
  }

  /**
   * Q1️⃣ Authoritative decision per type
   *
   * "What decision currently governs this case for X?"
   */
  async getAuthoritativeDecision(params: {
    tenantId: string;
    caseId: string;
    decisionType: DecisionType;
  }): Promise<DecisionExplanation | null> {
    const decision = await prisma.decision.findFirst({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        decisionType: params.decisionType,
        supersededAt: null,
      },
      orderBy: { decidedAt: "desc" },
    });

    return decision ? this.toDecisionExplanation(decision) : null;
  }

  /**
   * Q2️⃣ Decision chain (supersession history)
   *
   * "How did we get here?"
   */
  async getDecisionChain(params: {
    tenantId: string;
    caseId: string;
    decisionType: DecisionType;
  }): Promise<DecisionExplanation[]> {
    const decisions = await prisma.decision.findMany({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        decisionType: params.decisionType,
      },
      orderBy: { decidedAt: "asc" },
    });

    return decisions.map((d) => this.toDecisionExplanation(d));
  }

  /**
   * Q3️⃣ Lifecycle explanation (projection reasoning)
   *
   * "Why is the case in this lifecycle?"
   */
  async explainLifecycle(params: { tenantId: string; caseId: string }) {
    const caseRow = await prisma.case.findFirst({
      where: {
        id: params.caseId,
        tenantId: params.tenantId,
      },
      select: { lifecycle: true },
    });

    if (!caseRow) {
      throw new Error("Case not found");
    }

    const decision = await prisma.decision.findFirst({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        supersededAt: null,
      },
      orderBy: { decidedAt: "desc" },
    });

    return {
      lifecycle: caseRow.lifecycle,
      causedByDecision: decision ? this.toDecisionExplanation(decision) : null,
    };
  }

  /**
   * Q4️⃣ Ledger-backed fact trail
   *
   * "What immutable facts were recorded about this case?"
   */
  async getLedgerTrail(params: { tenantId: string; caseId: string }) {
    return prisma.ledgerCommit.findMany({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
      },
      orderBy: { ts: "asc" },
    });
  }

  /**
   * Counterfactuals (read-only, safe)
   *
   * "What would have happened under different constraints?"
   */
  async getRoutingCounterfactual(params: { tenantId: string; caseId: string }) {
    return prisma.counterfactualRecord.findFirst({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
        decisionType: DecisionType.ROUTING,
      },
    });
  }
}
