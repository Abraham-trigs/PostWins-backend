import { ActorKind, LedgerEventType } from "@posta/core/types";
import { SYSTEM_AUTHORITY_PROOF } from "../../domain/system/systemActors";

export async function commitAcceptanceLedger({
  ledger,
  postWinId,
  executionBodyId,
  actor,
}: {
  ledger: {
    commit: (data: any) => Promise<void>;
  };
  postWinId: string;
  executionBodyId: string;
  actor: { kind: "SYSTEM" } | { kind: "USER"; userId: string; orgKey: string };
}) {
  await ledger.commit({
    eventType: LedgerEventType.ACCEPTED,
    caseId: postWinId,

    actorKind: actor.kind === "SYSTEM" ? ActorKind.SYSTEM : ActorKind.USER,

    actorUserId: actor.kind === "USER" ? actor.userId : null,

    authorityProof:
      actor.kind === "SYSTEM" ? SYSTEM_AUTHORITY_PROOF : `org:${actor.orgKey}`,

    payload: {
      executionBodyId,
    },
  });
}
