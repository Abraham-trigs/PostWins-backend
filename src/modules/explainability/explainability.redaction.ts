// src/modules/explainability/explainability.redaction.ts
// Purpose: Role-based redaction for read-model DTOs only.
// This layer MUST NOT depend on Prisma entities.

import { DecisionExplanation } from "../decision/decision.types";
import { ExplainabilityRole } from "./explainability.types";
import { EXPLAINABILITY_POLICY } from "./explainability.policy";

////////////////////////////////////////////////////////////////
// Decision (Read DTO)
////////////////////////////////////////////////////////////////

export function redactDecision(
  decision: DecisionExplanation,
  role: ExplainabilityRole,
) {
  const p = EXPLAINABILITY_POLICY[role].decision;

  return {
    decisionId: decision.decisionId,
    decisionType: decision.decisionType,
    authoritative: decision.authoritative,
    decidedAt: decision.decidedAt,
    supersededAt: decision.supersededAt,

    actorKind: decision.actorKind,
    actorUserId: p.actorUserId ? decision.actorUserId : undefined,

    reason: p.reason ? decision.reason : undefined,
    intentContext: p.intentContext ? decision.intentContext : undefined,
  };
}

////////////////////////////////////////////////////////////////
// Ledger (Still Prisma Entity — intentional)
////////////////////////////////////////////////////////////////

export function redactLedgerCommit(
  commit: {
    id: string;
    eventType: string;
    ts: bigint;
    actorKind: string;
    actorUserId: string | null;
    intentContext: unknown;
    payload: unknown;
    authorityProof: string | null;
    signature: string | null;
    commitmentHash: string;
    supersedesCommitId: string | null;
  },
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

////////////////////////////////////////////////////////////////
// Routing Decision (Minimal Surface)
////////////////////////////////////////////////////////////////

export function redactRoutingDecision(
  decision: {
    id: string;
    routingOutcome: string;
    chosenExecutionBodyId: string;
    decidedAt: Date;
    decidedByUserId: string | null;
  },
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

////////////////////////////////////////////////////////////////
// Counterfactual
////////////////////////////////////////////////////////////////

export function allowCounterfactuals(role: ExplainabilityRole): boolean {
  return EXPLAINABILITY_POLICY[role].routing.counterfactual;
}

export function redactCounterfactual(
  record: {
    id: string;
    decisionType: string;
    chosen: string;
    constraintsApplied: unknown;
    alternatives: unknown;
    createdAt: Date;
  },
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

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Redaction must operate on read-model DTOs, not Prisma entities.
// Persistence layer and explainability layer must remain decoupled.
// This prevents accidental DB shape leakage into API contracts.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Decision redacts DecisionExplanation (read DTO)
// - Ledger accepts minimal structural surface
// - Routing + counterfactual minimal contracts
// - No Prisma imports

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Controllers must pass DTOs, not Prisma records.
// Redaction must never mutate.
// Serialization (Date → ISO string) belongs in mapper layer.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// This keeps redaction stable even if Prisma schema evolves.
// Read model remains the governance boundary.
// Prevents explainability layer from depending on DB internals.
