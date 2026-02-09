import { ExplainCaseResponse, DecisionView } from "./explain.case.contract";

export function mapExplainableCaseToResponse(
  payload: any,
): ExplainCaseResponse {
  const decisionsToView = (d: any): DecisionView => ({
    decisionId: d.id,
    decisionType: d.decisionType,
    decidedAt: d.decidedAt.toISOString(),
    actorKind: d.actorKind,
    actorUserId: d.actorUserId ?? undefined,
    reason: d.reason ?? undefined,
    intentContext: d.intentContext ?? undefined,
    supersededAt: d.supersededAt ? d.supersededAt.toISOString() : undefined,
  });

  const history = payload.authority.history.map(decisionsToView);
  const active = payload.authority.active.map(decisionsToView);

  const causedByDecision = active.length > 0 ? active[active.length - 1] : null;

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

    timeline: payload.case.timelineEntries.map((t: any) => ({
      id: t.id,
      type: t.type,
      body: t.body ?? undefined,
      createdAt: t.createdAt.toISOString(),
      evidenceCount: t.evidence?.length ?? 0,
      evidence: t.evidence ?? [],
    })),

    ledger: payload.ledger.map((l: any) => ({
      id: l.id,
      ts: Number(l.ts),
      eventType: l.eventType,
      actorKind: l.actorKind,
      payload: l.payload ?? undefined,
    })),

    policies: payload.policies?.map((p: any) => ({
      policyKey: p.policyKey,
      version: p.policyVersion ?? "unknown",
      evaluatedAt: p.evaluatedAt.toISOString(),
      result: p.context ?? {},
    })),

    counterfactuals: payload.counterfactuals?.map((c: any) => ({
      decisionType: c.decisionType,
      chosen: c.chosen,
      alternatives: c.alternatives,
      constraintsApplied: c.constraintsApplied,
    })),
  };
}
