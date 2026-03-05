// filepath: apps/backend/src/modules/disbursement/disburseCase.service.ts
// Purpose: Orchestrates full disbursement flow (authorize → execute) for internal workflows.

////////////////////////////////////////////////////////////
// ASSUMPTIONS
////////////////////////////////////////////////////////////
// - Shared domain types live in packages/core/src/types.ts
// - PAYEE_KINDS + PayeeKind define canonical allowed payee types
// - authorizeDisbursement enforces lifecycle invariants + ledger commit
// - executeDisbursement performs financial execution
// - This service is used by internal orchestrators (not public HTTP)

////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////

import { ActorKind, DisbursementType } from "@prisma/client";

import { PAYEE_KINDS, type PayeeKind } from "@posta/core/src/types";

import { authorizeDisbursement } from "./_internal/authorizeDisbursement.service";
import { executeDisbursement } from "./_internal/executeDisbursement.service";

////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////

export type DisburseCaseParams = {
  tenantId: string;
  caseId: string;

  type: DisbursementType;

  amount: number;
  currency: string;

  payee: {
    kind: PayeeKind;
    id: string;
  };

  actor: {
    kind: ActorKind;
    userId?: string;
    authorityProof: string;
  };
};

////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////

export async function disburseCase(params: DisburseCaseParams) {
  //////////////////////////////////////////////////////////
  // Phase 1 — Authorization
  //////////////////////////////////////////////////////////

  const authorization = await authorizeDisbursement({
    tenantId: params.tenantId,
    caseId: params.caseId,

    type: params.type,
    amount: params.amount,
    currency: params.currency,

    payee: params.payee,

    actor: params.actor,
  });

  //////////////////////////////////////////////////////////
  // Authorization denied
  //////////////////////////////////////////////////////////

  if (authorization.kind === "DENIED") {
    return authorization;
  }

  //////////////////////////////////////////////////////////
  // Phase 2 — Execution
  //////////////////////////////////////////////////////////

  return executeDisbursement({
    tenantId: params.tenantId,
    disbursementId: authorization.disbursementId,

    actor: params.actor,

    outcome: { success: true },
  });
}

////////////////////////////////////////////////////////////
// Example usage
////////////////////////////////////////////////////////////
/*
await disburseCase({
  tenantId,
  caseId,

  type: "PROVIDER_PAYMENT",

  amount: 1200,
  currency: "GHS",

  payee: {
    kind: "ORGANIZATION",
    id: organizationId
  },

  actor: {
    kind: "HUMAN",
    userId: staffUserId,
    authorityProof: `HUMAN:${staffUserId}:DISBURSE`
  }
});
*/

////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////
// This orchestrator composes authorization and execution phases.
// Authorization enforces lifecycle safety and writes the ledger event.
// Execution performs the financial settlement step.
// Splitting the phases allows retry-safe settlement engines and async payment providers.

////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////
// - DisburseCaseParams: canonical input contract
// - disburseCase(): orchestrates authorize → execute
// - Authorization result union respected (AUTHORIZED | DENIED)

////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////
// - Use this service in orchestrators or scheduled workers.
// - Public APIs should call authorize + execute endpoints separately.
// - Never bypass authorizeDisbursement for financial actions.

////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////
// This design allows introducing async settlement providers (Stripe, MoMo, Bank rails)
// by replacing the executeDisbursement step with a queue or provider adapter
// without changing authorization or ledger integrity.
