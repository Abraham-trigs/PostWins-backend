// apps/backend/src/modules/disbursement/disburseCase.service.ts

import { ActorKind } from "@prisma/client";
import { authorizeDisbursement } from "./_internal/authorizeDisbursement.service";
import { executeDisbursement } from "./_internal/executeDisbursement.service";
import { DisbursementType } from "@prisma/client";

export type DisburseCaseParams = {
  tenantId: string;
  caseId: string;

  type: DisbursementType;

  amount: number;
  currency: string;

  payee: {
    kind: "ORGANIZATION" | "USER" | "EXTERNAL_ACCOUNT";
    id: string;
  };

  actor: {
    kind: ActorKind;
    userId?: string;
    authorityProof: string;
  };
};

export async function disburseCase(params: DisburseCaseParams) {
  const authorization = await authorizeDisbursement({
    tenantId: params.tenantId,
    caseId: params.caseId,
    type: params.type,
    amount: params.amount,
    currency: params.currency,
    payee: params.payee,
    actor: params.actor,
  });

  // Correct union handling
  if (authorization.kind === "DENIED") {
    return authorization;
  }

  // Execution phase (separate authority)
  return executeDisbursement({
    tenantId: params.tenantId,
    disbursementId: authorization.disbursementId,
    actor: params.actor,
    outcome: { success: true },
  });
}
