// src/modules/orchestrator/orchestrator.service.ts
// Purpose: Executes governance-approved effects in a transactional boundary.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Design reasoning
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Orchestrator executes domain effects after governance approval.
// - Identity provisioning MUST NOT create users directly.
// - If user exists → assign role.
// - If user does NOT exist → issue invite token only.
// - Invite acceptance flow is the only place where user creation occurs.
// - All operations must remain tenant-scoped and transaction-safe.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Discriminated switch on GatedEffect
// - Lifecycle mutation delegated
// - Identity provisioning idempotent
// - Invite issuance replaces direct user creation

///////////////////////////////////////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Never create User records here.
// - Delete stale invites before issuing new ones.
// - Ensure role existence before proceeding.
// - Keep provisioning side-effect minimal.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Invite-first provisioning prevents phantom accounts.
// - Idempotent role assignment avoids duplication.
// - Tenant isolation prevents authority bleed.
// - Governance execution remains centralized and auditable.
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
      // PROVISION_VERIFIER (Invite-first provisioning)
      ////////////////////////////////////////////////////////////////
      case "PROVISION_VERIFIER": {
        const { email, roleKey } = effect.payload;

        ////////////////////////////////////////////////////////////////
        // 1️⃣ Ensure role exists in tenant
        ////////////////////////////////////////////////////////////////
        const role = await tx.role.findFirst({
          where: {
            tenantId,
            key: roleKey,
          },
        });

        if (!role) {
          throw new Error(`Role not found for key: ${roleKey}`);
        }

        ////////////////////////////////////////////////////////////////
        // 2️⃣ Check if user already exists in tenant
        ////////////////////////////////////////////////////////////////
        const existingUser = await tx.user.findFirst({
          where: {
            tenantId,
            email,
          },
        });

        ////////////////////////////////////////////////////////////////
        // 3️⃣ If user exists → assign role only (idempotent)
        ////////////////////////////////////////////////////////////////
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

        ////////////////////////////////////////////////////////////////
        // 4️⃣ If user does NOT exist → issue invite token ONLY
        ////////////////////////////////////////////////////////////////

        const rawToken = crypto.randomUUID();
        const tokenHash = crypto
          .createHash("sha256")
          .update(rawToken)
          .digest("hex");

        // Remove existing invite for same email in tenant
        await tx.inviteToken.deleteMany({
          where: {
            tenantId,
            email,
          },
        });

        await tx.inviteToken.create({
          data: {
            tenantId,
            email,
            roleKey,
            tokenHash,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
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
