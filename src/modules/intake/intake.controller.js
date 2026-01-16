"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleIntake = exports.handleIntakeFollowup = exports.handleIntakeDelivery = void 0;
const crypto_1 = __importDefault(require("crypto"));
// Local Service Imports
const intake_service_1 = require("./intake.service");
const verification_service_1 = require("../verification/verification.service");
const integrity_service_1 = require("./integrity.service");
const journey_service_1 = require("../routing/journey.service");
const ledger_service_1 = require("./ledger.service");
const task_service_1 = require("../../modules/routing/structuring/task.service");
const tone_adapter_service_1 = require("./tone-adapter.service");
const localization_service_1 = require("./localization.service");
const sdg_mapper_service_1 = require("./sdg-mapper.service");
// NEW: idempotency commit helper (your middleware provides this)
const idempotency_middleware_1 = require("../../middleware/idempotency.middleware");
// 1. Initialize Shared Infrastructure
const ledgerService = new ledger_service_1.LedgerService();
const integrityService = new integrity_service_1.IntegrityService();
const taskService = new task_service_1.TaskService();
const journeyService = new journey_service_1.JourneyService();
const toneAdapter = new tone_adapter_service_1.ToneAdapterService();
const localizationService = new localization_service_1.LocalizationService();
const sdgMapper = new sdg_mapper_service_1.SDGMapperService();
// 2. Initialize Services with Dependencies
const intakeService = new intake_service_1.IntakeService(integrityService, taskService);
const verificationService = new verification_service_1.VerificationService(ledgerService);
/**
 * Helper: read idempotency metadata attached by idempotencyGuard middleware
 */
function requireIdempotencyMeta(res) {
    const meta = res.locals.idempotency;
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
const handleIntakeDelivery = async (req, res) => {
    try {
        const { key, requestHash } = requireIdempotencyMeta(res);
        const { projectId, deliveryId, occurredAt, location, items, notes, } = req.body ?? {};
        // Minimal validation (we can swap to @postwins/core Zod once you add it)
        if (!projectId || !deliveryId || !occurredAt || !location || !items?.length) {
            return res.status(400).json({
                ok: false,
                error: "Missing required fields: projectId, deliveryId, occurredAt, location, items[]",
            });
        }
        const nowIso = new Date().toISOString();
        const entry = {
            id: "led_" + crypto_1.default.randomBytes(10).toString("hex"),
            type: "DELIVERY_RECORDED",
            projectId: String(projectId),
            occurredAt: new Date(occurredAt).toISOString(),
            recordedAt: nowIso,
            integrity: {
                idempotencyKey: key,
                requestHash,
                actorId: req.header("X-Actor-Id")?.trim() || undefined,
                source: req.header("X-Source")?.trim() || "api",
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
        await (0, idempotency_middleware_1.commitIdempotencyResponse)(res, responsePayload);
        return res.status(201).json(responsePayload);
    }
    catch (err) {
        console.error("Delivery Intake Error:", err);
        return res.status(500).json({ ok: false, error: "Posta System Error: Delivery intake failed." });
    }
};
exports.handleIntakeDelivery = handleIntakeDelivery;
/**
 * ============================================================================
 * NEW: Follow-up intake (field return visit / check-in)
 * POST /api/intake/followup
 * Writes to timeline ledger: type=FOLLOWUP_RECORDED
 * ============================================================================
 */
const handleIntakeFollowup = async (req, res) => {
    try {
        const { key, requestHash } = requireIdempotencyMeta(res);
        const { projectId, followupId, deliveryId, occurredAt, kind, notes, evidence, } = req.body ?? {};
        if (!projectId || !followupId || !deliveryId || !occurredAt || !kind) {
            return res.status(400).json({
                ok: false,
                error: "Missing required fields: projectId, followupId, deliveryId, occurredAt, kind",
            });
        }
        const nowIso = new Date().toISOString();
        const entry = {
            id: "led_" + crypto_1.default.randomBytes(10).toString("hex"),
            type: "FOLLOWUP_RECORDED",
            projectId: String(projectId),
            occurredAt: new Date(occurredAt).toISOString(),
            recordedAt: nowIso,
            integrity: {
                idempotencyKey: key,
                requestHash,
                actorId: req.header("X-Actor-Id")?.trim() || undefined,
                source: req.header("X-Source")?.trim() || "api",
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
        await (0, idempotency_middleware_1.commitIdempotencyResponse)(res, responsePayload);
        return res.status(201).json(responsePayload);
    }
    catch (err) {
        console.error("Follow-up Intake Error:", err);
        return res.status(500).json({ ok: false, error: "Posta System Error: Follow-up intake failed." });
    }
};
exports.handleIntakeFollowup = handleIntakeFollowup;
/**
 * ============================================================================
 * EXISTING: Beneficiary message intake (unchanged)
 * POST /api/intake  (legacy)
 * ============================================================================
 */
const handleIntake = async (req, res) => {
    try {
        const { message, beneficiaryId, taskCode, deviceId } = req.body;
        const transactionId = req.headers["x-transaction-id"];
        if (!message) {
            return res.status(400).json({ error: "No message provided" });
        }
        // --- SECTION F & M: INTEGRITY AUDIT ---
        const postWinSkeleton = { beneficiaryId };
        const integrityFlags = await integrityService.performFullAudit(postWinSkeleton, message, deviceId);
        // 1. Handle Permanent Blacklist (403)
        const isBlacklisted = deviceId && integrityFlags.some((f) => f.type === "IDENTITY_MISMATCH" && f.severity === "HIGH");
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
        const journey = journeyService.getOrCreateJourney(beneficiaryId);
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
        const postWin = {
            id: "pw_" + crypto_1.default.randomBytes(4).toString("hex"),
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
        const auditRecord = await ledgerService.commit({
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
    }
    catch (err) {
        console.error("Intake Controller Error:", err);
        res.status(500).json({ error: "Posta System Error: Escalated to Human-in-the-loop (HITL)." });
    }
};
exports.handleIntake = handleIntake;
