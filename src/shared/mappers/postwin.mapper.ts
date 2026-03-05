// apps/backend/src/shared/mappers/postwin.mapper.ts
// Purpose: Assemble a transport-safe PostWin DTO from Prisma models.

import type {
  Case,
  CaseAssignment,
  RoutingDecision,
  VerificationRecord,
  AuditEntry,
  Verification,
} from "@prisma/client";

import type {
  PostWin,
  AuditRecord,
  VerificationStatus,
  RoutingOutcome,
} from "@posta/core";

import {
  evaluateVerificationConsensus,
  deriveVerificationStatus,
} from "../../modules/verification/evaluateVerificationConsensus";

/* -------------------------------------------------------------------------- */
/* Helper Types                                                               */
/* -------------------------------------------------------------------------- */

type VerificationProjection =
  | (VerificationRecord & {
      receivedVerifications: Verification[];
    })
  | null;

export interface PostWinProjectionInput {
  caseRecord: Case;
  assignment?: CaseAssignment | null;
  latestRouting?: RoutingDecision | null;
  latestVerification?: VerificationProjection;
  auditEntries?: AuditEntry[] | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function mapRoutingStatus(
  routing?: RoutingDecision | null,
): RoutingOutcome | null {
  return routing?.routingOutcome ?? null;
}

function mapVerificationStatus(
  record?: VerificationProjection,
): VerificationStatus | null {
  if (!record) return null;

  const consensus = evaluateVerificationConsensus({
    requiredVerifiers: record.requiredVerifiers,
    votes: record.receivedVerifications,
  });

  return deriveVerificationStatus(consensus);
}
function mapAuditTrail(entries?: AuditEntry[] | null): AuditRecord[] {
  if (!entries || entries.length === 0) return [];

  return entries.map(
    (entry): AuditRecord => ({
      timestamp: entry.createdAt.getTime(),
      action: entry.note ?? "CASE_EVENT",
      actor: entry.actorLabel ?? "SYSTEM",
      note: entry.note ?? undefined,
    }),
  );
}
/* -------------------------------------------------------------------------- */
/* Mapper                                                                     */
/* -------------------------------------------------------------------------- */

export function mapCaseToPostWin(input: PostWinProjectionInput): PostWin {
  const {
    caseRecord,
    assignment,
    latestRouting,
    latestVerification,
    auditEntries,
  } = input;

  return {
    id: caseRecord.id,
    referenceCode: caseRecord.referenceCode,
    status: caseRecord.status,
    lifecycle: caseRecord.lifecycle,
    type: caseRecord.type,
    mode: caseRecord.mode,
    scope: caseRecord.scope,
    beneficiaryId: caseRecord.beneficiaryId ?? null,
    assignedBodyId: assignment?.executionBodyId ?? null,
    taskId: caseRecord.currentTaskDefinitionId ?? null,
    sdgGoal: caseRecord.sdgGoal ?? null,
    summary: caseRecord.summary ?? null,
    routingStatus: mapRoutingStatus(latestRouting),
    verificationStatus: mapVerificationStatus(latestVerification),
    auditTrail: mapAuditTrail(auditEntries),
    createdAt: caseRecord.createdAt.toISOString(),
  };
}

export function mapCasesToPostWins(
  inputs: PostWinProjectionInput[],
): PostWin[] {
  return inputs.map(mapCaseToPostWin);
}
