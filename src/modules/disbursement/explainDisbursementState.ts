// src/modules/disbursement/explainDisbursementState.ts

import { DisbursementStatus } from "@prisma/client";

export function explainDisbursementState(params: {
  disbursement: {
    status: DisbursementStatus;
  } & Record<string, unknown>;
  blockingReasons: string[];
}) {
  const { disbursement, blockingReasons } = params;

  const isTerminal =
    disbursement.status === DisbursementStatus.COMPLETED ||
    disbursement.status === DisbursementStatus.FAILED;

  const isInFlight = disbursement.status === DisbursementStatus.EXECUTING;

  return {
    status: disbursement.status,
    isTerminal,
    isInFlight,
    blockingReasons,
  };
}
