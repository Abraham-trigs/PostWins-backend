// filepath: src/modules/decision/decision.service.ts
// Purpose: Persist authoritative decisions with immutable history and delegate lifecycle effects to the orchestrator.

////////////////////////////////////////////////////////////////
// Assumptions
////////////////////////////////////////////////////////////////
// - Prisma schema includes Decision model with JSON intentContext
// - DecisionOrchestrationService executes lifecycle effects
// - intentContext must be valid JSON payload

////////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////////

import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { Prisma, ActorKind } from "@prisma/client";

import { DecisionOrchestrationService } from "./decision-orchestration.service";
import { ApplyDecisionParams } from "./decision.types";

////////////////////////////////////////////////////////////////
// Helper: Safe JSON normalization (replaces unsafe cast)
////////////////////////////////////////////////////////////////

function normalizeIntentContext(
  input: unknown,
): Prisma.InputJsonValue | undefined {
  if (input === undefined || input === null) return undefined;

  try {
    // Ensure JSON serializability
    return JSON.parse(JSON.stringify(input));
  } catch {
    throw new Error("Invalid intentContext JSON payload");
  }
}

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class DecisionService {
  constructor(private orchestrator: DecisionOrchestrationService) {}

  /**
   * Apply authoritative decision.
   *
   * Guarantees:
   * - Immutable decision history
   * - Explicit supersession
   * - Single active decision per (caseId, decisionType)
   * - Effect execution delegated
   */
  async applyDecision(
    params: ApplyDecisionParams,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const {
      tenantId,
      caseId,
      decisionType,
      actorKind,
      actorUserId,
      reason,
      intentContext,
      supersedesDecisionId,
      effect,
    } = params;

    ////////////////////////////////////////////////////////////////
    // 0️⃣ Defensive actor invariant
    ////////////////////////////////////////////////////////////////

    if (actorKind === ActorKind.HUMAN && !actorUserId) {
      throw new Error("HUMAN decisions require actorUserId");
    }

    ////////////////////////////////////////////////////////////////
    // 1️⃣ Validate supersession target (if provided)
    ////////////////////////////////////////////////////////////////

    if (supersedesDecisionId) {
      const target = await tx.decision.findFirst({
        where: {
          id: supersedesDecisionId,
          tenantId,
          caseId,
          decisionType,
          supersededAt: null,
        },
        select: { id: true },
      });

      if (!target) {
        throw new Error(
          `Supersession mismatch: expected active decision ${supersedesDecisionId}`,
        );
      }
    }

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Supersede active decisions atomically
    ////////////////////////////////////////////////////////////////

    await tx.decision.updateMany({
      where: {
        tenantId,
        caseId,
        decisionType,
        supersededAt: null,
      },
      data: {
        supersededAt: new Date(),
      },
    });

    ////////////////////////////////////////////////////////////////
    // 3️⃣ Persist immutable decision fact
    ////////////////////////////////////////////////////////////////

    const decision = await tx.decision.create({
      data: {
        id: crypto.randomUUID(),

        tenantId,
        caseId,
        decisionType,

        actorKind,
        actorUserId: actorKind === ActorKind.HUMAN ? actorUserId : null,

        reason,

        intentContext: normalizeIntentContext(intentContext),

        decidedAt: new Date(),

        supersedesDecisionId: supersedesDecisionId ?? null,
      },
      select: { id: true },
    });

    ////////////////////////////////////////////////////////////////
    // 4️⃣ Execute effect via Orchestrator
    ////////////////////////////////////////////////////////////////

    await this.orchestrator.executeDecisionEffect(
      {
        tenantId,
        caseId,
        decisionId: decision.id,
        effect,
        actorKind,
        actorUserId,
      },
      tx,
    );
  }
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Decisions are immutable facts. Supersession only marks previous decisions inactive,
// never mutates them. This ensures a complete historical audit trail.
//
// intentContext is normalized to safe JSON before persistence to prevent
// runtime Prisma serialization failures and to eliminate unsafe type casting.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - normalizeIntentContext() : JSON boundary validator
// - DecisionService.applyDecision() : transactional decision persistence
// - Orchestrator delegation for lifecycle effects

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Controllers should pass validated ApplyDecisionParams into this service.
// Lifecycle transitions must never occur here; they belong to the orchestrator.
//
// Example:
//
// await decisionService.applyDecision({
//   tenantId,
//   caseId,
//   decisionType: "APPROVE",
//   actorKind: "HUMAN",
//   actorUserId: staffId,
//   reason: "Eligibility verified",
//   effect: { type: "ADVANCE_LIFECYCLE" }
// });

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// This pattern supports:
// - decision replay
// - deterministic lifecycle reconstruction
// - future policy simulation
// because decisions remain immutable and effects are executed separately.
