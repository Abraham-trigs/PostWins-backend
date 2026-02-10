import { SYSTEM_AUTHORITY_PROOF } from "../../domain/system/systemActors";
import type { RoutingResult } from "./routing.types";
import { LedgerEventType, ActorKind } from "../../types";

export async function commitRoutingLedger({
  ledger,
  caseId,
  routingResult,
  intentCode,
}: {
  ledger: {
    commit: (data: any) => Promise<void>;
  };
  caseId: string;
  routingResult: RoutingResult;
  intentCode: string;
}) {
  await ledger.commit({
    eventType: LedgerEventType.ROUTED,
    caseId,

    actorKind: ActorKind.SYSTEM,
    actorUserId: null,
    authorityProof: SYSTEM_AUTHORITY_PROOF,

    intentContext: {
      source: "SYSTEM_RULE",
      rule: routingResult.reason,
    },

    payload: {
      executionBodyId: routingResult.executionBodyId,
      intentCode,
    },
  });
}
