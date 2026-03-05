// apps/backend/src/modules/decision/decision.query.service.ts
// Purpose: Decision explainability + ledger-backed lifecycle integrity validation (schema-aligned + type-safe)

import { prisma } from "../../lib/prisma";
import {
  Decision,
  DecisionType,
  CaseLifecycle,
  LedgerEventType,
} from "@prisma/client";
import { DecisionExplanation } from "./decision.types";
import { deriveLifecycleFromLedger } from "../cases/deriveLifecycleFromLedger";

/**
 * ============================================================
 * Assumptions
 * ------------------------------------------------------------
 * - Prisma schema exactly matches provided schema.prisma
 * - Decision.supersededAt is nullable (Date | null)
 * - Decision.intentContext is Json | null
 * - deriveLifecycleFromLedger() is deterministic and pure
 * - Service is READ ONLY
 * ============================================================
 */

export class DecisionQueryService {
  ////////////////////////////////////////////////////////////////
  // Mapper (strict DTO projection)
  ////////////////////////////////////////////////////////////////

  private toDecisionExplanation(decision: Decision): DecisionExplanation {
    return {
      decisionId: decision.id,
      decisionType: decision.decisionType,

      authoritative: decision.supersededAt === null,

      // FIX: must return null not undefined
      supersededAt: decision.supersededAt ?? null,

      actorKind: decision.actorKind,

      actorUserId: decision.actorUserId ?? undefined,

      decidedAt: decision.decidedAt,

      reason: decision.reason ?? undefined,

      // FIX: ensure Record<string, unknown> | null | undefined
      intentContext:
        decision.intentContext !== null
          ? (decision.intentContext as Record<string, unknown>)
          : undefined,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Q1 — Authoritative Decision
  ////////////////////////////////////////////////////////////////

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

  ////////////////////////////////////////////////////////////////
  // Q2 — Decision Chain
  ////////////////////////////////////////////////////////////////

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

  ////////////////////////////////////////////////////////////////
  // Q3 — Lifecycle Explanation + Drift Detection
  ////////////////////////////////////////////////////////////////

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

    ////////////////////////////////////////////////////////////////
    // Ledger Replay (deterministic projection)
    ////////////////////////////////////////////////////////////////

    const ledgerEvents = await prisma.ledgerCommit.findMany({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
      },
      orderBy: { ts: "asc" },
      select: { eventType: true },
    });

    const derivedLifecycle: CaseLifecycle = deriveLifecycleFromLedger(
      ledgerEvents.map((e) => ({
        eventType: e.eventType as LedgerEventType,
      })),
    );

    const drift = derivedLifecycle !== caseRow.lifecycle;

    ////////////////////////////////////////////////////////////////
    // Causal decision
    ////////////////////////////////////////////////////////////////

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
      ledgerDerivedLifecycle: derivedLifecycle,
      drift,
      causedByDecision: decision ? this.toDecisionExplanation(decision) : null,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Q4 — Ledger Trail
  ////////////////////////////////////////////////////////////////

  async getLedgerTrail(params: { tenantId: string; caseId: string }) {
    return prisma.ledgerCommit.findMany({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
      },
      orderBy: { ts: "asc" },
    });
  }

  ////////////////////////////////////////////////////////////////
  // Counterfactual
  ////////////////////////////////////////////////////////////////

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

/**
 * ============================================================
 * Design reasoning
 * ------------------------------------------------------------
 * Fixes strict typing mismatches between Prisma model and
 * DecisionExplanation DTO. Prisma uses Date | null and Json | null,
 * while DTO expects controlled union types. Mapping normalizes this.
 *
 * ============================================================
 * Structure
 * ------------------------------------------------------------
 * - DTO mapper
 * - Authoritative decision query
 * - Decision chain query
 * - Lifecycle explainability
 * - Ledger trail
 * - Counterfactual lookup
 *
 * ============================================================
 * Implementation guidance
 * ------------------------------------------------------------
 * Used by:
 * - decision.query.controller.ts
 * - explain.case.Controller.ts
 * - governance monitoring
 *
 * Example:
 *
 * const service = new DecisionQueryService()
 * const result = await service.getAuthoritativeDecision({
 *   tenantId,
 *   caseId,
 *   decisionType: DecisionType.ROUTING
 * })
 *
 * ============================================================
 * Scalability insight
 * ------------------------------------------------------------
 * Ledger replay is O(n). For large ledgers add snapshot
 * checkpoints every N events to avoid full replay.
 * ============================================================
 */
