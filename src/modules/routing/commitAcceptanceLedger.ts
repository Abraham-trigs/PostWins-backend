import { ActorKind, LedgerEventType } from "@prisma/client";
import { SYSTEM_AUTHORITY_PROOF } from "../../domain/system/systemActors/ngo/systemActors";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";

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
    eventType: LedgerEventType.CASE_ACCEPTED,
    caseId: postWinId,

    actorKind: actor.kind === "SYSTEM" ? ActorKind.SYSTEM : ActorKind.HUMAN,

    actorUserId: actor.kind === "USER" ? actor.userId : null,

    authorityProof:
      actor.kind === "SYSTEM" ? SYSTEM_AUTHORITY_PROOF : `org:${actor.orgKey}`,

    payload: buildAuthorityEnvelopeV1({
      domain: "ROUTING",
      event: "ACCEPTED",
      data: {
        executionBodyId,
      },
    }),
  });
}
