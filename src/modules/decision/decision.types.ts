import { ActorKind, DecisionType } from "@prisma/client";

/**
 * Input shape for applying a decision.
 *
 * Used by write services (DecisionService).
 * This is NOT a read or explanation model.
 */
export type ApplyDecisionParams = {
  tenantId: string;
  caseId: string;

  decisionType: DecisionType;
  actorKind: ActorKind;
  actorUserId?: string;

  reason?: string;
  intentContext?: Record<string, unknown>;

  // Phase 4 — explicit supersession
  supersedesDecisionId?: string;
};

/**
 * Read-only explanation shape for decisions.
 *
 * This is a DTO, not a model.
 * It derives from Decision rows without inference.
 */
export type DecisionExplanation = {
  decisionId: string;
  decisionType: DecisionType;

  // authoritative === supersededAt === null
  authoritative: boolean;
  supersededAt?: Date;

  actorKind: ActorKind;
  actorUserId?: string;

  decidedAt: Date;
  reason?: string;
  intentContext?: Record<string, unknown>;
};
