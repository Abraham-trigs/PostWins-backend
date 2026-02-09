import {
  Decision,
  LedgerCommit,
  RoutingDecision,
  CounterfactualRecord,
} from "@prisma/client";
import { ExplainabilityRole } from "./explainability.types";
import { EXPLAINABILITY_POLICY } from "./explainability.policy";

// --------------------
// Decision
// --------------------
export function redactDecision(decision: Decision, role: ExplainabilityRole) {
  const p = EXPLAINABILITY_POLICY[role].decision;

  return {
    id: decision.id,
    decisionType: decision.decisionType,
    actorKind: decision.actorKind,
    decidedAt: decision.decidedAt,
    reason: p.reason ? decision.reason : undefined,
    intentContext: p.intentContext ? decision.intentContext : undefined,
    actorUserId: p.actorUserId ? decision.actorUserId : undefined,
    supersededAt: decision.supersededAt,
  };
}

// --------------------
// Ledger
// --------------------
export function redactLedgerCommit(
  commit: LedgerCommit,
  role: ExplainabilityRole,
) {
  const p = EXPLAINABILITY_POLICY[role].ledger;

  return {
    id: commit.id,
    eventType: commit.eventType,
    ts: commit.ts,
    actorKind: commit.actorKind,
    actorUserId: p.actorUserId ? commit.actorUserId : undefined,
    intentContext: p.intentContext ? commit.intentContext : undefined,
    payload: p.payload ? commit.payload : undefined,
    authorityProof: p.authorityProof ? commit.authorityProof : undefined,
    signature: p.signature ? commit.signature : undefined,
    commitmentHash: commit.commitmentHash,
    supersedesCommitId: commit.supersedesCommitId,
  };
}

// --------------------
// RoutingDecision
// --------------------
export function redactRoutingDecision(
  decision: RoutingDecision,
  role: ExplainabilityRole,
) {
  const p = EXPLAINABILITY_POLICY[role].routing;

  return {
    id: decision.id,
    routingOutcome: decision.routingOutcome,
    chosenExecutionBodyId: decision.chosenExecutionBodyId,
    decidedAt: decision.decidedAt,
    decidedByUserId: p.decidedByUserId ? decision.decidedByUserId : undefined,
  };
}

// --------------------
// Counterfactual
// --------------------
export function allowCounterfactuals(role: ExplainabilityRole): boolean {
  return EXPLAINABILITY_POLICY[role].routing.counterfactual;
}

export function redactCounterfactual(
  record: CounterfactualRecord,
  role: ExplainabilityRole,
) {
  if (!allowCounterfactuals(role)) return undefined;

  return {
    id: record.id,
    decisionType: record.decisionType,
    chosen: record.chosen,
    constraintsApplied: record.constraintsApplied,
    alternatives: record.alternatives,
    createdAt: record.createdAt,
  };
}
