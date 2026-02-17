// src/modules/cases/explain.case.mapper.ts
// Deterministic explainability projection.
// Strict separation between UI AuditEntry and LedgerCommit.
// No lifecycle mutation. Read-only mapping only.

import { ExplainCaseResponse, DecisionView } from "./explain.case.contract";
import {
  redactDisbursementExplanation,
  DisbursementExplanation,
} from "@/modules/explainability/redactDisbursementExplanation";
import { normalizeJsonObject } from "@/shared/json/jsonBoundary";
import {
  CaseLifecycle,
  CaseStatus,
  LedgerEventType,
  ActorKind,
  DecisionType,
  DisbursementStatus,
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
    snapshot: any;
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
// Disbursement Domain Builder (Date-based)
////////////////////////////////////////////////////////////////

function buildDisbursementDomainExplanation(
  snapshot: any,
  blockingReasons: string[],
): DisbursementExplanation {
  const isTerminal =
    snapshot.status === DisbursementStatus.COMPLETED ||
    snapshot.status === DisbursementStatus.FAILED;

  const whyExecuted =
    snapshot.status === DisbursementStatus.COMPLETED
      ? "Funds were successfully transferred and confirmed."
      : null;

  const whyNotExecuted =
    snapshot.status === DisbursementStatus.AUTHORIZED
      ? ["Awaiting execution processing."]
      : snapshot.status === DisbursementStatus.EXECUTING
        ? ["Execution is currently in progress."]
        : snapshot.status === DisbursementStatus.FAILED
          ? [snapshot.failureReason ?? "Execution failed."]
          : (blockingReasons ?? []);

  return {
    id: snapshot.id,
    caseId: snapshot.caseId,
    status: snapshot.status,
    type: snapshot.type,
    summary: `Disbursement ${snapshot.status.toLowerCase()}.`,
    amount: {
      value: String(snapshot.amount),
      currency: snapshot.currency,
    },
    payee:
      snapshot.payeeKind && snapshot.payeeId
        ? { kind: snapshot.payeeKind, id: snapshot.payeeId }
        : undefined,
    authority: snapshot.authorityProof
      ? { proof: snapshot.authorityProof }
      : undefined,
    timeline: {
      authorizedAt: snapshot.authorizedAt,
      executedAt: snapshot.executedAt ?? null,
      failedAt: snapshot.failedAt ?? null,
    },
    failure:
      snapshot.status === DisbursementStatus.FAILED
        ? { reason: snapshot.failureReason ?? "Unknown failure" }
        : null,
    explainability: {
      whyExecuted,
      whyNotExecuted,
      irreversibility: isTerminal ? "Terminal financial state reached." : null,
    },
  };
}

////////////////////////////////////////////////////////////////
// Mapper
////////////////////////////////////////////////////////////////

export function mapExplainableCaseToResponse(
  payload: ExplainableCasePayload,
  viewerRole?: any,
): ExplainCaseResponse {
  ////////////////////////////////////////////////////////////////
  // Authority Projection
  ////////////////////////////////////////////////////////////////

  const decisionsToView = (d: AuthorityDecision): DecisionView => ({
    decisionId: d.id,
    decisionType: d.decisionType,
    decidedAt: d.decidedAt.toISOString(),
    actorKind: d.actorKind,
    actorUserId: d.actorUserId ?? undefined,
    reason: d.reason ?? undefined,
    intentContext: normalizeJsonObject(d.intentContext),
    supersededAt: d.supersededAt ? d.supersededAt.toISOString() : undefined,
  });

  const history = payload.authority.history.map(decisionsToView);
  const active = payload.authority.active.map(decisionsToView);
  const causedByDecision = active.length > 0 ? active[active.length - 1] : null;

  ////////////////////////////////////////////////////////////////
  // Disbursement (Domain → Redact → Transport)
  ////////////////////////////////////////////////////////////////

  let disbursement: ExplainCaseResponse["disbursement"];

  if (payload.disbursement && viewerRole) {
    const domain = buildDisbursementDomainExplanation(
      payload.disbursement.snapshot,
      payload.disbursement.blockingReasons ?? [],
    );

    const redacted = redactDisbursementExplanation(domain, viewerRole);

    disbursement = {
      ...redacted,
      timeline: {
        authorizedAt: redacted.timeline.authorizedAt.toISOString(),
        executedAt: redacted.timeline.executedAt?.toISOString() ?? null,
        failedAt: redacted.timeline.failedAt?.toISOString() ?? null,
      },
    };
  }

  ////////////////////////////////////////////////////////////////
  // Ledger Projection
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
      payload: normalizeJsonObject(l.payload),
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
      result: normalizeJsonObject(p.context) ?? {},
    })),

    counterfactuals: (payload.counterfactuals ?? []).map((c) => ({
      decisionType: c.decisionType,
      chosen: c.chosen,
      alternatives: c.alternatives,
      constraintsApplied: c.constraintsApplied,
    })),

    disbursement,
  };
}
