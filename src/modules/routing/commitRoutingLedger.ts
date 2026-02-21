import { SYSTEM_AUTHORITY_PROOF } from "@/domain/system/systemActors/ngo/systemActors";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import {
  LedgerEventType,
  ActorKind,
  RoutingOutcome,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const CommitRoutingSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  intentCode: z.string().min(1),
  routingResult: z.object({
    executionBodyId: z.string().uuid(),
    outcome: z.nativeEnum(RoutingOutcome),
    reason: z.string().min(1),
  }),
});

export type CommitRoutingParams = z.infer<typeof CommitRoutingSchema>;

export async function commitRoutingLedger(
  ledger: LedgerService,
  input: unknown,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const { tenantId, caseId, routingResult, intentCode } =
    CommitRoutingSchema.parse(input);

  const client: Prisma.TransactionClient | typeof prisma = tx ?? prisma;

  ////////////////////////////////////////////////////////////////
  // 1️⃣ Detect prior active ROUTED commit (for supersession)
  ////////////////////////////////////////////////////////////////

  const previous = await client.ledgerCommit.findFirst({
    where: {
      tenantId,
      caseId,
      eventType: LedgerEventType.ROUTED,
      supersededBy: null, // active commit
    },
    orderBy: { ts: "desc" },
    select: { id: true },
  });

  const isSuperseding = Boolean(previous);

  ////////////////////////////////////////////////////////////////
  // 2️⃣ Commit authoritative ledger entry
  ////////////////////////////////////////////////////////////////

  await ledger.appendEntry(
    {
      tenantId,
      caseId,
      eventType: isSuperseding
        ? LedgerEventType.ROUTING_SUPERSEDED
        : LedgerEventType.ROUTED,

      actorKind: ActorKind.SYSTEM,
      actorUserId: null,
      authorityProof: SYSTEM_AUTHORITY_PROOF,

      supersedesCommitId: isSuperseding ? (previous?.id ?? null) : null,

      intentContext: {
        engine: "DETERMINISTIC_ROUTER_V1",
        decision: routingResult.outcome,
      },

      payload: buildAuthorityEnvelopeV1({
        domain: "ROUTING",
        event: isSuperseding ? "ROUTING_SUPERSEDED" : "ROUTED",
        data: {
          executionBodyId: routingResult.executionBodyId,
          intentCode,
          routingOutcome: routingResult.outcome,
          rule: routingResult.reason,
        },
      }),
    },
    tx,
  );
}
