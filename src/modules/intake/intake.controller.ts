// apps/backend/src/modules/intake/intake.controller.ts d
import crypto from "crypto";
import { Request, Response } from "express";

// Core Types from @posta/core
import { PostWin, AuditRecord, Journey } from "@posta/core";

// Local Service Imports
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
import { TaskId } from "@prisma/client";

// Idempotency helper
import { commitIdempotencyResponse } from "../../middleware/idempotency.middleware";

// Prisma + UUID utils
import { prisma } from "../../lib/prisma";
import { assertUuid, UUID_RE } from "../../utils/uuid";

// Domain authority
import { CaseLifecycle } from "../cases/CaseLifecycle";

// -----------------------------------------------------------------------------
// Infrastructure
// -----------------------------------------------------------------------------
const ledgerService = new LedgerService();
const integrityService = new IntegrityService();
const taskProgressionService = new TaskProgressionService();
const journeyService = new JourneyService();
const toneAdapter = new ToneAdapterService();
const localizationService = new LocalizationService();
const sdgMapper = new SDGMapperService();

const intakeService = new IntakeService(integrityService, new TaskService());
const verificationService = new VerificationService(ledgerService);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function requireIdempotencyMeta(res: Response): {
  key: string;
  requestHash: string;
} {
  const meta = (res.locals as any).idempotency as
    | { key: string; requestHash: string }
    | undefined;

  if (!meta?.key || !meta?.requestHash) {
    throw new Error(
      "Missing idempotency metadata. Ensure idempotencyGuard middleware is attached.",
    );
  }
  return meta;
}

function nowIso() {
  return new Date().toISOString();
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
  const createdAt = nowIso();
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
// BOOTSTRAP: Create Case + seed PostWin
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

    // Phase 1.5 canonical intake
    const intakeResult = await intakeService.handleIntake(
      String(narrative),
      req.header("X-Device-Id") ?? "unknown",
    );

    const createdCase = await prisma.case.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        authorUserId,
        beneficiaryId: beneficiaryUuid,

        mode: intakeResult.mode,
        scope: intakeResult.scope,
        type: intakeResult.intent,

        // ✅ Authoritative lifecycle (domain-owned)
        lifecycle: CaseLifecycle.INTAKE,
        currentTask: intakeResult.taskId as TaskId,

        summary: String(narrative).trim().slice(0, 240),
        sdgGoal:
          Array.isArray(sdgGoals) && sdgGoals.length > 0
            ? String(sdgGoals[0])
            : null,
      },
      select: { id: true },
    });

    const projectId = createdCase.id;
    const postWinId = crypto.randomUUID();
    const createdAt = nowIso();

    const goals: string[] =
      Array.isArray(sdgGoals) && sdgGoals.length > 0
        ? sdgGoals
        : ["SDG_4", "SDG_5"];

    const verificationRecords = seedVerificationRecords(goals);

    await ledgerService.appendEntry({
      id: crypto.randomUUID(),
      tenantId,
      type: "POSTWIN_BOOTSTRAPPED",
      projectId,
      occurredAt: createdAt,
      recordedAt: createdAt,
      integrity: {
        idempotencyKey: key,
        requestHash,
        actorId: authorUserId,
        actorUserId: authorUserId,
        source:
          (req.header("X-Source")?.trim() as "web" | "mobile" | "api") || "api",
        createdAt,
      },
      payload: {
        tenantId,
        caseId: projectId,
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

    const responsePayload = { ok: true, projectId, postWinId };
    await commitIdempotencyResponse(res, responsePayload);
    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error("BOOTSTRAP_FAILED", err);
    return res.status(500).json({
      ok: false,
      error: "Posta System Error: bootstrap intake failed.",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

// -----------------------------------------------------------------------------
// DELIVERY: Phase 2 task progression
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

    // Phase 2 — explicit task transition
    const nextTask = taskProgressionService.getNextTask(
      existingCase.currentTask,
      "ATTEND",
    );

    await prisma.case.update({
      where: { id: existingCase.id },
      data: { currentTask: nextTask },
    });

    const nowIsoStr = new Date().toISOString();

    await ledgerService.appendEntry({
      id: crypto.randomUUID(),
      tenantId,
      type: "DELIVERY_RECORDED", // Phase 2: formally map to CASE_UPDATED ledger intent
      projectId: String(projectId),
      occurredAt: new Date(occurredAt).toISOString(),
      recordedAt: nowIsoStr,
      integrity: {
        idempotencyKey: key,
        requestHash,
        actorId: req.header("X-Actor-Id")?.trim() || undefined,
        source:
          (req.header("X-Source")?.trim() as "web" | "mobile" | "api") || "api",
        createdAt: nowIsoStr,
      },
      payload: {
        tenantId,
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
      type: "DELIVERY_RECORDED",
      projectId: String(projectId),
      deliveryId: String(deliveryId),
    };

    await commitIdempotencyResponse(res, responsePayload);
    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error("Delivery Intake Error:", err);
    return res.status(500).json({
      ok: false,
      error: "Posta System Error: Delivery intake failed.",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};
