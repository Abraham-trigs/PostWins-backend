// apps/backend/src/modules/decision/decision.query.service.ts
// Decision explainability + ledger-backed lifecycle integrity validation.

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
 * Phase 6 — Read Model Governance Layer
 *
 * Purpose:
 * - Explain authoritative decisions
 * - Replay ledger to deterministically derive lifecycle
 * - Detect projection drift without mutating state
 *
 * Constraints:
 * - Read-only
 * - Deterministic
 * - No inference
 * - No transactional side effects
 *
 * This service is an integrity boundary.
 */

export class DecisionQueryService {
  /* -------------------------------------------------------------------------- */
  /* Internal Mapper — Explicit projection to stable DTO                       */
  /* -------------------------------------------------------------------------- */

  private toDecisionExplanation(decision: Decision): DecisionExplanation {
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

  /* -------------------------------------------------------------------------- */
  /* Q1 — Authoritative Decision                                                */
  /* -------------------------------------------------------------------------- */

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

  /* -------------------------------------------------------------------------- */
  /* Q2 — Decision Chain (Supersession History)                                 */
  /* -------------------------------------------------------------------------- */

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

  /* -------------------------------------------------------------------------- */
  /* Q3 — Lifecycle Explanation + Projection Drift Detection                    */
  /* -------------------------------------------------------------------------- */

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

    // Replay immutable ledger facts (ordered ASC for deterministic projection)
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
      drift, // true = projection inconsistency
      causedByDecision: decision ? this.toDecisionExplanation(decision) : null,
    };
  }

  /* -------------------------------------------------------------------------- */
  /* Q4 — Immutable Ledger Trail                                                */
  /* -------------------------------------------------------------------------- */

  async getLedgerTrail(params: { tenantId: string; caseId: string }) {
    return prisma.ledgerCommit.findMany({
      where: {
        tenantId: params.tenantId,
        caseId: params.caseId,
      },
      orderBy: { ts: "asc" },
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Counterfactual — Read-Only Simulation Record                               */
  /* -------------------------------------------------------------------------- */

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

/*
Architectural Position
----------------------
This layer governs read-side truth validation.

The lifecycle stored on Case is a projection.
The ledger is the source of truth.
This service proves the projection still matches the source.

Non-Goals
---------
- No projection repair
- No write-path coupling
- No hidden side effects

Operational Model
-----------------
Drift detection enables:
- Observability alerts
- Background reconciliation jobs
- Safe governance audits
- Horizontal read scaling

Failure Behavior
----------------
If drift is true:
- The system is still operational.
- The ledger remains canonical.
- Repair must occur in a separate reconciliation workflow.

Ownership
---------
Governance / Read-model integrity boundary.
*/
