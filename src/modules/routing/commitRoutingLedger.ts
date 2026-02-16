// apps/backend/src/modules/routing/commitRoutingLedger.ts
// Authoritative routing ledger commit. Explicit multi-tenant boundary.
// No event mutation. No enum shadowing. No implicit context.

import { SYSTEM_AUTHORITY_PROOF } from "@/domain/system/systemActors";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { LedgerEventType, ActorKind, RoutingOutcome } from "@prisma/client";
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
): Promise<void> {
  const { tenantId, caseId, routingResult, intentCode } =
    CommitRoutingSchema.parse(input);

  await ledger.commit({
    tenantId,
    caseId,

    eventType: LedgerEventType.ROUTED,

    actorKind: ActorKind.SYSTEM,
    actorUserId: null,
    authorityProof: SYSTEM_AUTHORITY_PROOF,

    intentContext: {
      source: "SYSTEM_RULE" as const,
      routingOutcome: routingResult.outcome,
      rule: routingResult.reason,
    },

    payload: {
      executionBodyId: routingResult.executionBodyId,
      intentCode,
    },
  });
}
