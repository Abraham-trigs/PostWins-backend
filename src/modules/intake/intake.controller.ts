// apps/backend/src/modules/intake/intake.controller.ts
// Constitutional intake controller aligned to LedgerCommitSchema

import crypto from "crypto";
import { Request, Response } from "express";

import { IntakeService } from "./intake.service";
import { VerificationService } from "../verification/verification.service";
import { IntegrityService } from "./intergrity/integrity.service";
import { JourneyService } from "../routing/journey/journey.service";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
import { TaskProgressionService } from "../routing/task-progression.service";
import { ToneAdapterService } from "./tone/tone-adapter.service";
import { LocalizationService } from "./localization/localization.service";
import { SDGMapperService } from "./sdg/sdg-mapper.service";
import { TaskService } from "../routing/structuring/task.service";
import { TaskId, LedgerEventType, ActorKind } from "@prisma/client";

import { commitIdempotencyResponse } from "../../middleware/idempotency.middleware";
import { prisma } from "../../lib/prisma";
import { assertUuid, UUID_RE } from "../../utils/uuid";
import { CaseLifecycle } from "../cases/CaseLifecycle";
import { DecisionService } from "../decision/decision.service";
import { DecisionOrchestrationService } from "../decision/decision-orchestration.service";
import { OrchestratorService } from "../orchestrator/orchestrator.service";

// -----------------------------------------------------------------------------
// Infrastructure (Explicit Composition Root)
// -----------------------------------------------------------------------------
const ledgerService = new LedgerService();
const integrityService = new IntegrityService();
const taskProgressionService = new TaskProgressionService();
const journeyService = new JourneyService();
const toneAdapter = new ToneAdapterService();
const localizationService = new LocalizationService();
const sdgMapper = new SDGMapperService();

const intakeService = new IntakeService(integrityService, new TaskService());

// Updated dependency chain
const orchestratorService = new OrchestratorService();

const decisionOrchestrator = new DecisionOrchestrationService(
  orchestratorService,
);

const decisionService = new DecisionService(decisionOrchestrator);

const verificationService = new VerificationService(
  ledgerService,
  decisionService,
);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function requireIdempotencyMeta(res: Response) {
  const meta = (res.locals as any).idempotency;
  if (!meta?.key || !meta?.requestHash) {
    throw new Error(
      "Missing idempotency metadata. Ensure idempotencyGuard middleware is attached.",
    );
  }
  return meta;
}

function requireTenantId(req: Request): string {
  const tenantId = req.header("X-Tenant-Id")?.trim() || "";
  assertUuid(tenantId, "tenantId");
  return tenantId;
}

async function resolveAuthorUserId(
  req: Request,
  tenantId: string,
): Promise<string> {
  const actorHeader = req.header("X-Actor-Id")?.trim();
  if (actorHeader && UUID_RE.test(actorHeader)) return actorHeader;

  const user = await prisma.user.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!user?.id) {
    throw new Error(
      "No active user found for this tenant. Seed a user or pass X-Actor-Id.",
    );
  }

  return user.id;
}

function seedVerificationRecords(sdgGoals: string[]) {
  const createdAt = new Date().toISOString();
  return sdgGoals.map((sdgGoal) => ({
    sdgGoal,
    requiredVerifiers: 2,
    receivedVerifications: [],
    consensusReached: false,
    timestamps: { createdAt },
  }));
}

// -----------------------------------------------------------------------------
// Resolve GhanaPost Address
// -----------------------------------------------------------------------------
export const handleResolveLocation = async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code ?? "").trim();

    if (!code) {
      return res.status(400).json({ ok: false, error: "Missing code" });
    }

    const result = await intakeService.resolveGhanaPostAddress(code);

    return res.status(200).json({
      lat: result.lat,
      lng: result.lng,
      bounds: result.bounds,
    });
  } catch (err) {
    console.error("Resolve Location Error:", err);
    return res
      .status(502)
      .json({ ok: false, error: "Failed to resolve location" });
  }
};

// -----------------------------------------------------------------------------
// BOOTSTRAP → CASE_CREATED
// -----------------------------------------------------------------------------
export const handleIntakeBootstrap = async (req: Request, res: Response) => {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

    const tenantId = requireTenantId(req);
    const authorUserId = await resolveAuthorUserId(req, tenantId);

    const { narrative, beneficiaryId, category, location, language, sdgGoals } =
      req.body ?? {};

    if (!narrative || String(narrative).trim().length < 10) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: narrative (min 10 chars)",
      });
    }

    const beneficiaryUuid =
      beneficiaryId && UUID_RE.test(String(beneficiaryId))
        ? String(beneficiaryId)
        : null;

    const intakeResult = await intakeService.handleIntake(
      String(narrative),
      req.header("X-Device-Id") ?? "unknown",
    );

    const referenceCode = `CASE-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`;

    const createdCase = await prisma.case.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        authorUserId,
        beneficiaryId: beneficiaryUuid,
        referenceCode,
        mode: intakeResult.mode,
        scope: intakeResult.scope,
        type: intakeResult.intent,
        lifecycle: CaseLifecycle.INTAKE,
        currentTask: intakeResult.taskId as TaskId,
        summary: String(narrative).trim().slice(0, 240),
      },
      select: { id: true },
    });

    const caseId = createdCase.id;
    const postWinId = crypto.randomUUID();

    const goals =
      Array.isArray(sdgGoals) && sdgGoals.length > 0
        ? sdgGoals
        : ["SDG_4", "SDG_5"];

    const verificationRecords = seedVerificationRecords(goals);

    await ledgerService.appendEntry({
      tenantId,
      caseId,
      eventType: LedgerEventType.CASE_CREATED,
      actorKind: ActorKind.HUMAN,
      actorUserId: authorUserId,
      authorityProof: `HUMAN:${authorUserId}:${key}:${requestHash}`,
      intentContext: {
        idempotencyKey: key,
        requestHash,
      },
      payload: {
        caseId,
        postWinId,
        narrative: String(narrative).trim(),
        beneficiaryId: beneficiaryUuid ?? undefined,
        category,
        location,
        language,
        sdgGoals: goals,
        verificationRecords,
      },
    });

    const responsePayload = { ok: true, projectId: caseId, postWinId };

    await commitIdempotencyResponse(res, responsePayload);

    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error("BOOTSTRAP_FAILED", err);
    return res.status(500).json({
      ok: false,
      error: "PostWins System Error: bootstrap intake failed.",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

// -----------------------------------------------------------------------------
// DELIVERY → EXECUTION_PROGRESS_RECORDED
// -----------------------------------------------------------------------------
export const handleIntakeDelivery = async (req: Request, res: Response) => {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);
    const tenantId = requireTenantId(req);

    const { projectId, deliveryId, occurredAt, location, items, notes } =
      req.body ?? {};

    if (
      !projectId ||
      !deliveryId ||
      !occurredAt ||
      !location ||
      !items?.length
    ) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing required fields: projectId, deliveryId, occurredAt, location, items[]",
      });
    }

    assertUuid(projectId, "projectId");

    const existingCase = await prisma.case.findFirst({
      where: { id: String(projectId), tenantId },
      select: { id: true, currentTask: true },
    });

    if (!existingCase) {
      return res.status(404).json({
        ok: false,
        error: `Case not found for projectId=${String(projectId)}`,
      });
    }

    const nextTask = taskProgressionService.getNextTask(
      existingCase.currentTask,
      "ATTEND",
    );

    await prisma.case.update({
      where: { id: existingCase.id },
      data: { currentTask: nextTask },
    });

    const actorUserId = req.header("X-Actor-Id")?.trim() || null;

    await ledgerService.appendEntry({
      tenantId,
      caseId: String(projectId),
      eventType: LedgerEventType.EXECUTION_PROGRESS_RECORDED,
      actorKind: actorUserId ? ActorKind.HUMAN : ActorKind.SYSTEM,
      actorUserId: actorUserId ?? null,
      authorityProof: actorUserId
        ? `HUMAN:${actorUserId}:${key}:${requestHash}`
        : `SYSTEM:${key}:${requestHash}`,
      intentContext: {
        idempotencyKey: key,
        requestHash,
      },
      payload: {
        caseId: String(projectId),
        deliveryId: String(deliveryId),
        occurredAt: new Date(occurredAt).toISOString(),
        location,
        items,
        notes,
      },
    });

    const responsePayload = {
      ok: true,
      type: "EXECUTION_PROGRESS_RECORDED",
      projectId: String(projectId),
      deliveryId: String(deliveryId),
    };

    await commitIdempotencyResponse(res, responsePayload);

    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error("Delivery Intake Error:", err);
    return res.status(500).json({
      ok: false,
      error: "PostWins System Error: Delivery intake failed.",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};
