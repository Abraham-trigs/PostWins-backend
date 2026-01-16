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

// NEW: idempotency commit helper (your middleware provides this)
import { commitIdempotencyResponse } from "../../middleware/idempotency.middleware";

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
function requireIdempotencyMeta(res: Response): { key: string; requestHash: string } {
  const meta = (res.locals as any).idempotency as { key: string; requestHash: string } | undefined;
  if (!meta?.key || !meta?.requestHash) {
    // If this happens, it means the route forgot to include idempotencyGuard
    throw new Error("Missing idempotency metadata. Ensure idempotencyGuard middleware is attached.");
  }
  return meta;
}

/**
 * ============================================================================
 * NEW: Delivery intake (for NGO ops / field team)
 * POST /api/intake/delivery
 * Writes to timeline ledger: type=DELIVERY_RECORDED
 * ============================================================================
 */
export const handleIntakeDelivery = async (req: Request, res: Response) => {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

    const {
      projectId,
      deliveryId,
      occurredAt,
      location,
      items,
      notes,
    } = req.body ?? {};

    // Minimal validation (we can swap to @postwins/core Zod once you add it)
    if (!projectId || !deliveryId || !occurredAt || !location || !items?.length) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: projectId, deliveryId, occurredAt, location, items[]",
      });
    }

    const nowIso = new Date().toISOString();

    const entry = {
      id: "led_" + crypto.randomBytes(10).toString("hex"),
      type: "DELIVERY_RECORDED",
      projectId: String(projectId),
      occurredAt: new Date(occurredAt).toISOString(),
      recordedAt: nowIso,
      integrity: {
        idempotencyKey: key,
        requestHash,
        actorId: req.header("X-Actor-Id")?.trim() || undefined,
        source: (req.header("X-Source")?.trim() as "web" | "mobile" | "api") || "api",
        createdAt: nowIso,
      },
      payload: {
        projectId: String(projectId),
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
    return res.status(500).json({ ok: false, error: "Posta System Error: Delivery intake failed." });
  }
};

/**
 * ============================================================================
 * NEW: Follow-up intake (field return visit / check-in)
 * POST /api/intake/followup
 * Writes to timeline ledger: type=FOLLOWUP_RECORDED
 * ============================================================================
 */
export const handleIntakeFollowup = async (req: Request, res: Response) => {
  try {
    const { key, requestHash } = requireIdempotencyMeta(res);

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
        error: "Missing required fields: projectId, followupId, deliveryId, occurredAt, kind",
      });
    }

    const nowIso = new Date().toISOString();

    const entry = {
      id: "led_" + crypto.randomBytes(10).toString("hex"),
      type: "FOLLOWUP_RECORDED",
      projectId: String(projectId),
      occurredAt: new Date(occurredAt).toISOString(),
      recordedAt: nowIso,
      integrity: {
        idempotencyKey: key,
        requestHash,
        actorId: req.header("X-Actor-Id")?.trim() || undefined,
        source: (req.header("X-Source")?.trim() as "web" | "mobile" | "api") || "api",
        createdAt: nowIso,
      },
      payload: {
        projectId: String(projectId),
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
    return res.status(500).json({ ok: false, error: "Posta System Error: Follow-up intake failed." });
  }
};

/**
 * ============================================================================
 * EXISTING: Beneficiary message intake (unchanged)
 * POST /api/intake  (legacy)
 * ============================================================================
 */
export const handleIntake = async (req: Request, res: Response) => {
  try {
    const { message, beneficiaryId, taskCode, deviceId } = req.body;
    const transactionId = req.headers["x-transaction-id"] as string;

    if (!message) {
      return res.status(400).json({ error: "No message provided" });
    }

    // --- SECTION F & M: INTEGRITY AUDIT ---
    const postWinSkeleton = { beneficiaryId } as PostWin;
    const integrityFlags = await integrityService.performFullAudit(postWinSkeleton, message, deviceId);

    // 1. Handle Permanent Blacklist (403)
    const isBlacklisted =
      deviceId && integrityFlags.some((f) => f.type === "IDENTITY_MISMATCH" && f.severity === "HIGH");
    if (isBlacklisted) {
      return res.status(403).json({
        status: "banned",
        error: "Access denied: Permanent flag for repeated violations.",
      });
    }

    // 2. Handle Rate Limiting / Cooldown (429)
    const cooldownFlag = integrityFlags.find((f) => f.type === "SUSPICIOUS_TONE" && f.severity === "LOW");
    if (cooldownFlag) {
      return res.status(429).json({
        status: "throttled",
        error: "Too many requests. Please wait 30 seconds.",
      });
    }

    // 3. Handle Fraud/Integrity Violations (409)
    if (integrityFlags.some((f) => f.severity === "HIGH")) {
      return res.status(409).json({
        status: "flagged",
        error: "Integrity violation: Security guardrails triggered.",
        flags: integrityFlags,
      });
    }

    // --- SECTION E: JOURNEY VALIDATION ---
    const journey: Journey = journeyService.getOrCreateJourney(beneficiaryId);
    if (!journeyService.validateTaskSequence(journey, taskCode)) {
      return res.status(403).json({
        status: "blocked",
        note: `Prerequisites for ${taskCode} not met.`,
      });
    }

    // --- SECTION N: LOCALIZATION & NEUTRALIZATION ---
    const localization = await localizationService.detectCulture(message);
    const neutralizedDescription = await localizationService.neutralizeAndTranslate(message, localization);

    // --- SECTION A, N & G.2: CONTEXT & LITERACY ---
    const detectedContext = await intakeService.detectContext(message);

    // --- SDG MAPPING ---
    const assignedGoals = sdgMapper.mapMessageToGoals(message);

    // Initialize PostWin entity (Compliant with @posta/core)
    const postWin: PostWin = {
      id: "pw_" + crypto.randomBytes(4).toString("hex"),
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

    // --- SECTION L: IMMUTABLE AUDIT ---
    const auditRecord: AuditRecord = await ledgerService.commit({
      timestamp: Date.now(),
      postWinId: postWin.id,
      action: "INTAKE",
      actorId: beneficiaryId,
      previousState: "NONE",
      newState: "PENDING_VERIFICATION",
    });

    // --- REQUIREMENT G.2 & G.3: TONE ADAPTATION ---
    const outcomeMessage = toneAdapter.adaptOutcome(postWin, detectedContext);

    // --- SECTION G: RESPONSE ---
    res.json({
      status: "success",
      message: outcomeMessage,
      transactionId,
      context: { ...detectedContext, localization },
      audit: auditRecord,
      postWin,
      journeyState: journey,
    });

    // --- SECTION K: COMPLETION ---
    journeyService.completeTask(beneficiaryId, taskCode);
  } catch (err: any) {
    console.error("Intake Controller Error:", err);
    res.status(500).json({ error: "Posta System Error: Escalated to Human-in-the-loop (HITL)." });
  }
};
