// apps/backend/src/modules/routing/commitRoutingLedger.ts
// Authoritative routing ledger commit.
// Explicit multi-tenant boundary.
// Transaction-aware. No enum shadowing. No mutation.
// Enforced Authority Envelope V1.

import { SYSTEM_AUTHORITY_PROOF } from "@/domain/system/systemActors";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { buildAuthorityEnvelopeV1 } from "@/modules/intake/ledger/authorityEnvelope";
import {
  LedgerEventType,
  ActorKind,
  RoutingOutcome,
  Prisma,
} from "@prisma/client";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

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

////////////////////////////////////////////////////////////////
// Commit
////////////////////////////////////////////////////////////////

export async function commitRoutingLedger(
  ledger: LedgerService,
  input: unknown,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const { tenantId, caseId, routingResult, intentCode } =
    CommitRoutingSchema.parse(input);

  await ledger.appendEntry(
    {
      tenantId,
      caseId,
      eventType: LedgerEventType.ROUTED,

      actorKind: ActorKind.SYSTEM,
      actorUserId: null,
      authorityProof: SYSTEM_AUTHORITY_PROOF,

      intentContext: {
        source: "SYSTEM_RULE",
        routingOutcome: routingResult.outcome,
        rule: routingResult.reason,
      },

      payload: buildAuthorityEnvelopeV1({
        domain: "ROUTING",
        event: "ROUTED",
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
