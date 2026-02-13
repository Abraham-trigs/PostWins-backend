import { authorizeDisbursement } from "./_internal/authorizeDisbursement.service";
import { executeDisbursement } from "./_internal/executeDisbursement.service";

export async function disburseCase(caseId: string, actorId: string) {
  const authorization = await authorizeDisbursement({
    caseId,
    actorId,
  });

  if (!authorization.authorized) {
    return authorization;
  }

  return executeDisbursement({
    disbursementId: authorization.disbursementId,
  });
}
