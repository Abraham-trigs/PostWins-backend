// apps/backend/src/modules/intake/intake.controller.ts
import crypto from "crypto";
import { Request, Response } from "express";

// Core Types from @posta/core
import { PostWin, AuditRecord, Journey } from "@posta/core";

// Local Service Imports
import { IntakeService } from "./intake.service";
import { VerificationService } from "../verification/verification.service";
import { IntegrityService } from "./integrity.service";
import { JourneyService } from "../routing/journey.service";
import { LedgerService } from "./ledger.service";
import { TaskService } from "../../modules/routing/structuring/task.service";
import { ToneAdapterService } from "./tone-adapter.service";
import { LocalizationService } from "./localization.service";
import { SDGMapperService } from "./sdg-mapper.service";

// Idempotency helper
import { commitIdempotencyResponse } from "../../middleware/idempotency.middleware";
// Prisma + UUID utils
import { prisma } from "../../lib/prisma";
import { assertUuid, UUID_RE } from "../../utils/uuid";

// 1. Initialize Shared Infrastructure
const ledgerService = new LedgerService();
const integrityService = new IntegrityService();
const taskService = new TaskService();
const journeyService = new JourneyService();
const toneAdapter = new ToneAdapterService();
const localizationService = new LocalizationService();
const sdgMapper = new SDGMapperService();

// 2. Initialize Services with Dependencies
const intakeService = new IntakeService(integrityService, taskService);
const verificationService = new VerificationService(ledgerService);

/**
 * Helper: read idempotency metadata attached by idempotencyGuard middleware
 */
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
      "No active user found for this tenant. Seed a user or pass X-Actor-Id (UUID).",
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

export const handleResolveLocation = async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code ?? "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Missing required query param: code",
      });
    }

    const result = await intakeService.resolveGhanaPostAddress(code);

    return res.status(200).json({
      lat: result.lat,
      lng: result.lng,
      bounds: result.bounds,
    });
  } catch (err: any) {
    console.error("Resolve Location Error:", err);
    return res.status(502).json({
      ok: false,
      error: "Failed to resolve location",
    });
  }
};

/**
 * ============================================================================
 * BOOTSTRAP: Create Case + seed PostWin (UI "New PostWin" button)
 * POST /api/intake/bootstrap
 * ============================================================================
 */
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

    // ✅ Phase 1.5 — canonical intake resolution
    const intakeResult = await intakeService.handleIntake(
      String(narrative),
      req.header("X-Device-Id") ?? "unknown",
    );

    // ✅ Persist resolved intake metadata (NO defaults)
    const createdCase = await prisma.case.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        authorUserId,
        beneficiaryId: beneficiaryUuid,

        mode: intakeResult.mode,
        scope: intakeResult.scope,
        type: intakeResult.intent,

        lifecycle: "INTAKE",
        currentTask: intakeResult.taskId,

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

    const timelineEntry = {
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
        category: category ? String(category) : undefined,
        location: location ?? undefined,
        language: language ? String(language) : undefined,
        sdgGoals: goals,
        verificationRecords,
      },
    };

    await ledgerService.appendEntry(timelineEntry);

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

/**
 * ============================================================================
 * NEW: Delivery intake
 * POST /api/intake/delivery
 * ============================================================================
 */
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

    const existing = await prisma.case.findFirst({
      where: { id: String(projectId), tenantId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: `Case not found for projectId=${String(projectId)}`,
      });
    }

    const nowIsoStr = new Date().toISOString();

    const entry = {
      id: crypto.randomUUID(),
      tenantId,
      type: "DELIVERY_RECORDED",
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
    };

    await ledgerService.appendEntry(entry);

    const responsePayload = {
      ok: true,
      type: "DELIVERY_RECORDED",
      projectId: entry.projectId,
      deliveryId: entry.payload.deliveryId,
    };

    await commitIdempotencyResponse(res, responsePayload);
    return res.status(201).json(responsePayload);
  } catch (err: any) {
    console.error("Delivery Intake Error:", err);
    return res.status(500).json({
      ok: false,
      error: "Posta System Error: Delivery intake failed.",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * ============================================================================
 * NEW: Follow-up intake
 * POST /api/intake/followup
 * ============================================================================
 */
export const handleIntakeFollowup = async (req: Request, res: Response) => {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

    const tenantId = requireTenantId(req);

    const {
      projectId,
      followupId,
      deliveryId,
      occurredAt,
      kind,
      notes,
      evidence,
    } = req.body ?? {};

    if (!projectId || !followupId || !deliveryId || !occurredAt || !kind) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing required fields: projectId, followupId, deliveryId, occurredAt, kind",
      });
    }

    assertUuid(projectId, "projectId");

    const existing = await prisma.case.findFirst({
      where: { id: String(projectId), tenantId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: `Case not found for projectId=${String(projectId)}`,
      });
    }

    const nowIsoStr = new Date().toISOString();

    const entry = {
      id: crypto.randomUUID(),
      tenantId,
      type: "FOLLOWUP_RECORDED",
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
        followupId: String(followupId),
        deliveryId: String(deliveryId),
        occurredAt: new Date(occurredAt).toISOString(),
        kind: String(kind),
        notes,
        evidence: Array.isArray(evidence) ? evidence : [],
      },
    };

    await ledgerService.appendEntry(entry);

    const responsePayload = {
      ok: true,
      type: "FOLLOWUP_RECORDED",
      projectId: entry.projectId,
      followupId: entry.payload.followupId,
      deliveryId: entry.payload.deliveryId,
    };

    await commitIdempotencyResponse(res, responsePayload);
    return res.status(201).json(responsePayload);
  } catch (err: any) {
    console.error("Follow-up Intake Error:", err);
    return res.status(500).json({
      ok: false,
      error: "Posta System Error: Follow-up intake failed.",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * ============================================================================
 * EXISTING: Beneficiary message intake (legacy)
 * POST /api/intake
 * ============================================================================
 */
export const handleIntake = async (req: Request, res: Response) => {
  try {
    const { message, beneficiaryId, taskCode, deviceId } = req.body;
    const transactionId = req.headers["x-transaction-id"] as string;

    if (!message) {
      return res.status(400).json({ error: "No message provided" });
    }

    const postWinSkeleton = { beneficiaryId } as PostWin;
    const integrityFlags = await integrityService.performFullAudit(
      postWinSkeleton,
      message,
      deviceId,
    );

    const isBlacklisted =
      deviceId &&
      integrityFlags.some(
        (f) => f.type === "IDENTITY_MISMATCH" && f.severity === "HIGH",
      );
    if (isBlacklisted) {
      return res.status(403).json({
        status: "banned",
        error: "Access denied: Permanent flag for repeated violations.",
      });
    }

    const cooldownFlag = integrityFlags.find(
      (f) => f.type === "SUSPICIOUS_TONE" && f.severity === "LOW",
    );
    if (cooldownFlag) {
      return res.status(429).json({
        status: "throttled",
        error: "Too many requests. Please wait 30 seconds.",
      });
    }

    if (integrityFlags.some((f) => f.severity === "HIGH")) {
      return res.status(409).json({
        status: "flagged",
        error: "Integrity violation: Security guardrails triggered.",
        flags: integrityFlags,
      });
    }

    const journey: Journey = journeyService.getOrCreateJourney(beneficiaryId);
    if (!journeyService.validateTaskSequence(journey, taskCode)) {
      return res.status(403).json({
        status: "blocked",
        note: `Prerequisites for ${taskCode} not met.`,
      });
    }

    const localization = await localizationService.detectCulture(message);
    const neutralizedDescription =
      await localizationService.neutralizeAndTranslate(message, localization);

    const detectedContext = await intakeService.detectContext(message);
    const assignedGoals = sdgMapper.mapMessageToGoals(message);

    const postWin: PostWin = {
      id: crypto.randomUUID(),
      taskId: taskCode,
      routingStatus: "FALLBACK",
      verificationStatus: integrityFlags.length > 0 ? "FLAGGED" : "PENDING",
      beneficiaryId,
      authorId: beneficiaryId,
      description: neutralizedDescription,
      sdgGoals: assignedGoals,
      mode: "AI_AUGMENTED",
      verificationRecords: [],
      auditTrail: [],
      localization,
    };

    const auditRecord: AuditRecord = await ledgerService.commit({
      ts: Date.now(),
      postWinId: postWin.id,
      action: "INTAKE",
      actorId: beneficiaryId,
      previousState: "NONE",
      newState: "PENDING_VERIFICATION",
    });

    const outcomeMessage = toneAdapter.adaptOutcome(postWin, detectedContext);

    res.json({
      status: "success",
      message: outcomeMessage,
      transactionId,
      context: { ...detectedContext, localization },
      audit: auditRecord,
      postWin,
      journeyState: journey,
    });

    journeyService.completeTask(beneficiaryId, taskCode);
  } catch (err: any) {
    console.error("Intake Controller Error:", err);
    res.status(500).json({
      error: "Posta System Error: Escalated to Human-in-the-loop (HITL).",
    });
  }
};
