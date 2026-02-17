import {
  ActorKind,
  CaseLifecycle,
  CaseStatus,
  DecisionType,
  LedgerEventType,
  DisbursementStatus,
} from "@prisma/client";

export type ExplainCaseRequest = {
  ref: {
    kind: "CASE" | "DECISION" | "POLICY" | "LEDGER" | "TAG";
    id?: string;
    policyKey?: string;
    value?: string;
  };
};

export type DecisionView = {
  decisionId: string;
  decisionType: DecisionType;
  decidedAt: string;

  actorKind: ActorKind;
  actorUserId?: string;

  reason?: string;
  intentContext?: Record<string, unknown>;

  supersededAt?: string;
};

export type TimelineEntryView = {
  id: string;
  type: string;
  body?: string;
  createdAt: string;

  evidenceCount: number;
  evidence?: unknown[];
};

export type LedgerCommitView = {
  id: string;
  ts: number;
  eventType: LedgerEventType;
  actorKind: ActorKind;
  payload?: Record<string, unknown>;
};

export type PolicyEvaluationView = {
  policyKey: string;
  version: string;
  evaluatedAt: string;
  result: Record<string, unknown>;
};

export type CounterfactualView = {
  decisionType: DecisionType;
  chosen: string;
  alternatives: unknown;
  constraintsApplied: string[];
};

export type DisbursementExplanation = {
  id: string;
  caseId: string;

  status: string;
  type: string;

  summary: string;

  amount: {
    value: string;
    currency: string;
  };

  payee?: {
    kind: string;
    id: string;
  };

  authority?: {
    proof: string;
  };

  timeline: {
    authorizedAt: string;
    executedAt: string | null;
    failedAt: string | null;
  };

  failure?: {
    reason: string;
  } | null;

  explainability: {
    whyExecuted: string | null;
    whyNotExecuted: string[];
    irreversibility: string | null;
  };
};

export type ExplainCaseResponse = {
  case: {
    id: string;
    lifecycle: CaseLifecycle;
    status: CaseStatus;
    createdAt: string;
    updatedAt: string;
    summary?: string;
    sdgGoal?: string;
  };

  authority: {
    active: DecisionView[];
    history: DecisionView[];
  };

  lifecycleExplanation: {
    lifecycle: CaseLifecycle;
    causedByDecision: DecisionView | null;
  };

  timeline: TimelineEntryView[];
  ledger: LedgerCommitView[];
  policies?: PolicyEvaluationView[];
  counterfactuals?: CounterfactualView[];
  disbursement?: DisbursementExplanation;
};
