// src/modules/cases/explain.case.mapper.ts
// Deterministic explainability projection.
// Strict separation between UI AuditEntry and LedgerCommit.
// No lifecycle mutation. Read-only mapping only.

import { ExplainCaseResponse, DecisionView } from "./explain.case.contract";
import { explainDisbursementState } from "../disbursement";
import { redactDisbursementExplanation } from "@/modules/explainability/redactDisbursementExplanation";
import {
  CaseLifecycle,
  CaseStatus,
  LedgerEventType,
  ActorKind,
  DecisionType,
} from "@prisma/client";

////////////////////////////////////////////////////////////////
// Types (strict projection boundary)
////////////////////////////////////////////////////////////////

type ExplainableCasePayload = {
  case: {
    id: string;
    lifecycle: CaseLifecycle;
    status: CaseStatus;
    createdAt: Date;
    updatedAt: Date;
    summary?: string | null;
    sdgGoal?: string | null;
    timelineEntries: Array<{
      id: string;
      type: string;
      body?: string | null;
      createdAt: Date;
      evidence?: unknown[];
    }>;
  };

  authority: {
    active: AuthorityDecision[];
    history: AuthorityDecision[];
  };

  ledger: Array<{
    id: string;
    ts: bigint;
    eventType: LedgerEventType;
    actorKind: ActorKind;
    payload: unknown;
  }>;

  policies?: Array<{
    policyKey: string;
    policyVersion?: string | null;
    evaluatedAt: Date;
    context?: unknown;
  }>;

  counterfactuals?: Array<{
    decisionType: DecisionType;
    chosen: string;
    alternatives: unknown;
    constraintsApplied: string[];
  }>;

  disbursement?: {
    snapshot: unknown;
    blockingReasons?: string[];
  };
};

type AuthorityDecision = {
  id: string;
  decisionType: DecisionType;
  decidedAt: Date;
  actorKind: ActorKind;
  actorUserId?: string | null;
  reason?: string | null;
  intentContext?: unknown;
  supersededAt?: Date | null;
};

////////////////////////////////////////////////////////////////
// Mapper
////////////////////////////////////////////////////////////////

export function mapExplainableCaseToResponse(
  payload: ExplainableCasePayload,
  viewerRole?: string,
): ExplainCaseResponse {
  ////////////////////////////////////////////////////////////////
  // Authority Projection (deterministic)
  ////////////////////////////////////////////////////////////////

  const decisionsToView = (d: AuthorityDecision): DecisionView => ({
    decisionId: d.id,
    decisionType: d.decisionType,
    decidedAt: d.decidedAt.toISOString(),
    actorKind: d.actorKind,
    actorUserId: d.actorUserId ?? undefined,
    reason: d.reason ?? undefined,
    intentContext: d.intentContext ?? undefined,
    supersededAt: d.supersededAt ? d.supersededAt.toISOString() : undefined,
  });

  // Defensive copy to avoid upstream mutation side-effects
  const history = [...payload.authority.history].map(decisionsToView);
  const active = [...payload.authority.active].map(decisionsToView);

  // Deterministic causal explanation: last active decision only
  const causedByDecision = active.length > 0 ? active[active.length - 1] : null;

  ////////////////////////////////////////////////////////////////
  // Disbursement Explainability (Redacted by Viewer Role)
  ////////////////////////////////////////////////////////////////

  const disbursementExplanation =
    payload.disbursement && viewerRole
      ? redactDisbursementExplanation(
          explainDisbursementState({
            disbursement: payload.disbursement.snapshot,
            blockingReasons: payload.disbursement.blockingReasons ?? [],
          }),
          viewerRole,
        )
      : undefined;

  ////////////////////////////////////////////////////////////////
  // Ledger Projection (ordered + safe bigint handling)
  ////////////////////////////////////////////////////////////////

  const orderedLedger = [...payload.ledger].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );

  const ledgerProjection = orderedLedger.map((l) => {
    const tsNumber =
      l.ts <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(l.ts)
        : Number.MAX_SAFE_INTEGER;

    return {
      id: l.id,
      ts: tsNumber,
      eventType: l.eventType,
      actorKind: l.actorKind,
      payload: l.payload ?? undefined,
    };
  });

  ////////////////////////////////////////////////////////////////
  // Response
  ////////////////////////////////////////////////////////////////

  return {
    case: {
      id: payload.case.id,
      lifecycle: payload.case.lifecycle,
      status: payload.case.status,
      createdAt: payload.case.createdAt.toISOString(),
      updatedAt: payload.case.updatedAt.toISOString(),
      summary: payload.case.summary ?? undefined,
      sdgGoal: payload.case.sdgGoal ?? undefined,
    },

    authority: {
      active,
      history,
    },

    lifecycleExplanation: {
      lifecycle: payload.case.lifecycle,
      causedByDecision,
    },

    timeline: payload.case.timelineEntries.map((t) => ({
      id: t.id,
      type: t.type,
      body: t.body ?? undefined,
      createdAt: t.createdAt.toISOString(),
      evidenceCount: t.evidence?.length ?? 0,
      evidence: t.evidence ?? [],
    })),

    ledger: ledgerProjection,

    policies: (payload.policies ?? []).map((p) => ({
      policyKey: p.policyKey,
      version: p.policyVersion ?? "unknown",
      evaluatedAt: p.evaluatedAt.toISOString(),
      result: p.context ?? {},
    })),

    counterfactuals: (payload.counterfactuals ?? []).map((c) => ({
      decisionType: c.decisionType,
      chosen: c.chosen,
      alternatives: c.alternatives,
      constraintsApplied: c.constraintsApplied,
    })),

    disbursement: disbursementExplanation,
  };
}
