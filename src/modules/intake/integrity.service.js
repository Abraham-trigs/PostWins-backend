"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrityService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class IntegrityService {
    processedHashes = new Set();
    deviceRegistry = new Map();
    lastActivity = new Map();
    violationCounters = new Map(); // Section M.5: Tracks HIGH severity counts
    blacklist = new Set(); // Section M.5: Permanent ban list
    // IMPORTANT: use process.cwd() (works in dev + dist builds)
    registryPath = path_1.default.join(process.cwd(), "device_registry.json");
    blacklistPath = path_1.default.join(process.cwd(), "blacklist.json");
    // NEW: idempotency persistence (used by idempotency.middleware.ts)
    dataDir = path_1.default.join(process.cwd(), "data");
    idempotencyPath = path_1.default.join(this.dataDir, "idempotency.json");
    COOLDOWN_MS = 30000;
    MAX_VIOLATIONS = 5;
    constructor() {
        this.ensureDir(this.dataDir);
        this.ensureIdempotencyFile();
        this.loadRegistry();
        this.loadBlacklist();
    }
    /**
     * Section F & M: Multi-layered integrity check with Blacklist Enforcement
     */
    async performFullAudit(postWin, rawMessage, deviceId) {
        // 1. Section M.5: Instant rejection if on Blacklist
        if (deviceId && this.blacklist.has(deviceId)) {
            return [
                {
                    type: "IDENTITY_MISMATCH",
                    severity: "HIGH",
                    timestamp: Date.now(),
                },
            ];
        }
        const flags = [];
        // 2. Rate Limit / Cooldown Check (Section M.4)
        if (deviceId) {
            const cooldownFlag = this.checkCooldown(deviceId);
            if (cooldownFlag)
                flags.push(cooldownFlag);
        }
        // 3. Basic Duplicate Check (Section F)
        const duplicate = this.checkDuplicate(rawMessage);
        if (duplicate)
            flags.push(duplicate);
        // 4. Ghost Beneficiary Detection (Section M.1)
        if (deviceId) {
            const ghostFlag = this.detectGhostBeneficiary(deviceId, postWin.beneficiaryId);
            if (ghostFlag)
                flags.push(ghostFlag);
        }
        // 5. Adversarial Input Shield (Section M.2)
        if (this.isAdversarial(rawMessage)) {
            flags.push({ type: "SUSPICIOUS_TONE", severity: "HIGH", timestamp: Date.now() });
        }
        // 6. Section M.5: Update Violation Counters and trigger Blacklist
        if (deviceId && flags.some((f) => f.severity === "HIGH")) {
            this.handleViolation(deviceId);
        }
        return flags;
    }
    handleViolation(deviceId) {
        const count = (this.violationCounters.get(deviceId) || 0) + 1;
        this.violationCounters.set(deviceId, count);
        if (count >= this.MAX_VIOLATIONS) {
            this.blacklist.add(deviceId);
            this.saveBlacklist();
        }
    }
    checkCooldown(deviceId) {
        const now = Date.now();
        const lastTime = this.lastActivity.get(deviceId) || 0;
        if (now - lastTime < this.COOLDOWN_MS) {
            return { type: "SUSPICIOUS_TONE", severity: "LOW", timestamp: now };
        }
        this.lastActivity.set(deviceId, now);
        return null;
    }
    checkDuplicate(message) {
        const hash = message.toLowerCase().trim();
        if (this.processedHashes.has(hash)) {
            return { type: "DUPLICATE_CLAIM", severity: "HIGH", timestamp: Date.now() };
        }
        this.processedHashes.add(hash);
        return null;
    }
    detectGhostBeneficiary(deviceId, beneficiaryId) {
        const linkedBeneficiaries = this.deviceRegistry.get(deviceId) || [];
        if (!linkedBeneficiaries.includes(beneficiaryId)) {
            linkedBeneficiaries.push(beneficiaryId);
            this.deviceRegistry.set(deviceId, linkedBeneficiaries);
            this.saveRegistry();
        }
        if (linkedBeneficiaries.length > 3) {
            return { type: "IDENTITY_MISMATCH", severity: "HIGH", timestamp: Date.now() };
        }
        return null;
    }
    isAdversarial(message) {
        const patterns = [/ignore previous instructions/i, /system override/i, /<script/i];
        return patterns.some((pattern) => pattern.test(message));
    }
    // ==========================================================================
    // NEW: Idempotency persistence API (used by idempotency.middleware.ts)
    // ==========================================================================
    /**
     * Get an idempotency record by key.
     * Returns null if not found.
     */
    async get(key) {
        const db = this.loadIdempotency();
        const record = db.keys[key];
        if (!record)
            return null;
        return { requestHash: record.requestHash, response: record.response };
    }
    /**
     * Save an idempotency record (key -> requestHash + response).
     * This allows safe retry + replay across restarts.
     */
    async save(key, requestHash, response) {
        const db = this.loadIdempotency();
        db.keys[key] = {
            requestHash,
            response,
            recordedAt: new Date().toISOString(),
        };
        this.writeIdempotency(db);
    }
    ensureIdempotencyFile() {
        try {
            if (!fs_1.default.existsSync(this.idempotencyPath)) {
                const init = { keys: {} };
                fs_1.default.writeFileSync(this.idempotencyPath, JSON.stringify(init, null, 2));
            }
        }
        catch (e) {
            // If this fails, idempotency becomes best-effort (but we try hard to persist).
            console.error("Idempotency store init failed:", e);
        }
    }
    loadIdempotency() {
        try {
            if (!fs_1.default.existsSync(this.idempotencyPath))
                return { keys: {} };
            const raw = fs_1.default.readFileSync(this.idempotencyPath, "utf8");
            const parsed = JSON.parse(raw);
            return {
                keys: typeof parsed?.keys === "object" && parsed?.keys ? parsed.keys : {},
            };
        }
        catch {
            return { keys: {} };
        }
    }
    writeIdempotency(db) {
        try {
            fs_1.default.writeFileSync(this.idempotencyPath, JSON.stringify(db, null, 2));
        }
        catch (e) {
            console.error("Idempotency store save failed:", e);
        }
    }
    ensureDir(dir) {
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
    }
    // --- Persistence Methods (existing) ---------------------------------------
    saveRegistry() {
        try {
            const data = JSON.stringify(Object.fromEntries(this.deviceRegistry), null, 2);
            fs_1.default.writeFileSync(this.registryPath, data);
        }
        catch (e) {
            console.error("Registry save failed:", e);
        }
    }
    saveBlacklist() {
        try {
            const data = JSON.stringify(Array.from(this.blacklist), null, 2);
            fs_1.default.writeFileSync(this.blacklistPath, data);
        }
        catch (e) {
            console.error("Blacklist save failed:", e);
        }
    }
    loadRegistry() {
        try {
            if (fs_1.default.existsSync(this.registryPath)) {
                const data = JSON.parse(fs_1.default.readFileSync(this.registryPath, "utf8"));
                this.deviceRegistry = new Map(Object.entries(data));
            }
        }
        catch {
            this.deviceRegistry = new Map();
        }
    }
    loadBlacklist() {
        try {
            if (fs_1.default.existsSync(this.blacklistPath)) {
                const data = JSON.parse(fs_1.default.readFileSync(this.blacklistPath, "utf8"));
                this.blacklist = new Set(data);
            }
        }
        catch {
            this.blacklist = new Set();
        }
    }
}
exports.IntegrityService = IntegrityService;
