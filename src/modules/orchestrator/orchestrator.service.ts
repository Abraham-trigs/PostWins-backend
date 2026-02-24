// src/modules/orchestrator/orchestrator.service.ts
// Purpose: Executes governance-approved effects in a transactional boundary.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Design reasoning
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Orchestrator executes domain effects after governance approval.
// - Every GatedEffect must be exhaustively handled to preserve governance determinism.
// - Identity provisioning MUST NOT create users directly.
// - Tenant isolation enforced in every branch.
// - Fail-fast for unimplemented effects rather than weakening type guarantees.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Discriminated switch on GatedEffect
// - Lifecycle mutation delegated
// - Identity provisioning idempotent
// - Placeholder guarded execution for financial / routing effects
// - Exhaustive never-check retained

///////////////////////////////////////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Replace "Not implemented" branches with delegated domain services.
// - Keep all financial mutations inside same transaction boundary.
// - Never bypass tenantId in queries.
// - Do not remove exhaustive switch guard.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////////////////////////////////////
// Exhaustive switching forces explicit governance evolution.
// New effect kinds will fail compilation until orchestrator supports them.
// This prevents silent policy drift.
///////////////////////////////////////////////////////////////////////////////////////////////////

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { transitionCaseLifecycleWithLedger } from "@/modules/cases/transitionCaseLifecycleWithLedger";
import { Prisma, ActorKind, CaseLifecycle } from "@prisma/client";
import { GatedEffect } from "../approvals/approval.types";

type ExecuteEffectParams = {
  tenantId: string;
  caseId: string;
  decisionId: string;
  effect: GatedEffect;
};

type ActorContext = {
  kind: ActorKind;
  userId?: string;
  authorityProof: string;
};

export class OrchestratorService {
  async executeEffect(
    params: ExecuteEffectParams,
    actor: ActorContext,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const { tenantId, caseId, effect } = params;

    switch (effect.kind) {
      ////////////////////////////////////////////////////////////////
      // EXECUTION_VERIFIED
      ////////////////////////////////////////////////////////////////
      case "EXECUTION_VERIFIED": {
        await transitionCaseLifecycleWithLedger(
          {
            tenantId,
            caseId,
            target: CaseLifecycle.VERIFIED,
            actor,
          },
          tx,
        );
        return;
      }

      ////////////////////////////////////////////////////////////////
      // ROUTE_CASE
      ////////////////////////////////////////////////////////////////
      case "ROUTE_CASE": {
        // TODO: delegate to routing.service
        throw new Error("ROUTE_CASE not implemented in OrchestratorService");
      }

      ////////////////////////////////////////////////////////////////
      // AUTHORIZE_BUDGET
      ////////////////////////////////////////////////////////////////
      case "AUTHORIZE_BUDGET": {
        // TODO: delegate to grant allocation domain
        throw new Error(
          "AUTHORIZE_BUDGET not implemented in OrchestratorService",
        );
      }

      ////////////////////////////////////////////////////////////////
      // RELEASE_TRANCHE
      ////////////////////////////////////////////////////////////////
      case "RELEASE_TRANCHE": {
        // TODO: delegate to tranche.service
        throw new Error(
          "RELEASE_TRANCHE not implemented in OrchestratorService",
        );
      }

      ////////////////////////////////////////////////////////////////
      // AUTHORIZE_DISBURSEMENT
      ////////////////////////////////////////////////////////////////
      case "AUTHORIZE_DISBURSEMENT": {
        // TODO: delegate to disbursement module
        throw new Error(
          "AUTHORIZE_DISBURSEMENT not implemented in OrchestratorService",
        );
      }

      ////////////////////////////////////////////////////////////////
      // ADVANCE_TASK
      ////////////////////////////////////////////////////////////////
      case "ADVANCE_TASK": {
        // TODO: delegate to task progression service
        throw new Error("ADVANCE_TASK not implemented in OrchestratorService");
      }

      ////////////////////////////////////////////////////////////////
      // ESCALATE_CASE
      ////////////////////////////////////////////////////////////////
      case "ESCALATE_CASE": {
        // TODO: delegate to case escalation service
        throw new Error("ESCALATE_CASE not implemented in OrchestratorService");
      }

      ////////////////////////////////////////////////////////////////
      // ARCHIVE_CASE
      ////////////////////////////////////////////////////////////////
      case "ARCHIVE_CASE": {
        // TODO: delegate to lifecycle archive handler
        throw new Error("ARCHIVE_CASE not implemented in OrchestratorService");
      }

      ////////////////////////////////////////////////////////////////
      // PROVISION_VERIFIER
      ////////////////////////////////////////////////////////////////
      case "PROVISION_VERIFIER": {
        const { email, roleKey } = effect.payload;

        const role = await tx.role.findFirst({
          where: { tenantId, key: roleKey },
        });

        if (!role) {
          throw new Error(`Role not found for key: ${roleKey}`);
        }

        const existingUser = await tx.user.findFirst({
          where: { tenantId, email },
        });

        if (existingUser) {
          const existingUserRole = await tx.userRole.findFirst({
            where: {
              userId: existingUser.id,
              roleId: role.id,
            },
          });

          if (!existingUserRole) {
            await tx.userRole.create({
              data: {
                id: crypto.randomUUID(),
                userId: existingUser.id,
                roleId: role.id,
              },
            });
          }

          return;
        }

        const rawToken = crypto.randomUUID();
        const tokenHash = crypto
          .createHash("sha256")
          .update(rawToken)
          .digest("hex");

        await tx.inviteToken.deleteMany({
          where: { tenantId, email },
        });

        await tx.inviteToken.create({
          data: {
            tenantId,
            email,
            roleKey,
            tokenHash,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });

        return;
      }

      ////////////////////////////////////////////////////////////////
      // Exhaustiveness safety
      ////////////////////////////////////////////////////////////////
      default: {
        const exhaustiveCheck: never = effect;
        throw new Error(`Unsupported effect: ${(exhaustiveCheck as any).kind}`);
      }
    }
  }
}
