"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LedgerService = void 0;
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class LedgerService {
    // ---- Paths (use process.cwd() so it works in dev + dist) ----
    auditLedgerPath = path_1.default.join(process.cwd(), "audit_ledger.json");
    dataDir = path_1.default.join(process.cwd(), "data");
    timelineLedgerPath = path_1.default.join(this.dataDir, "ledger.json");
    keysDir = path_1.default.join(this.dataDir, "keys");
    privateKeyPath = path_1.default.join(this.keysDir, "private.pem");
    publicKeyPath = path_1.default.join(this.keysDir, "public.pem");
    privateKey;
    publicKey;
    constructor() {
        // Ensure dirs exist
        this.ensureDir(this.dataDir);
        this.ensureDir(this.keysDir);
        // Load or create signing keys (CRITICAL: persist keys across restarts)
        const existingPriv = fs_1.default.existsSync(this.privateKeyPath)
            ? fs_1.default.readFileSync(this.privateKeyPath, "utf8")
            : null;
        const existingPub = fs_1.default.existsSync(this.publicKeyPath)
            ? fs_1.default.readFileSync(this.publicKeyPath, "utf8")
            : null;
        if (existingPriv && existingPub) {
            this.privateKey = existingPriv;
            this.publicKey = existingPub;
        }
        else {
            const { privateKey, publicKey } = (0, crypto_1.generateKeyPairSync)("rsa", {
                modulusLength: 2048,
            });
            this.privateKey = privateKey.export({ type: "pkcs8", format: "pem" });
            this.publicKey = publicKey.export({ type: "spki", format: "pem" });
            fs_1.default.writeFileSync(this.privateKeyPath, this.privateKey, "utf8");
            fs_1.default.writeFileSync(this.publicKeyPath, this.publicKey, "utf8");
        }
        // Ensure audit ledger exists
        if (!fs_1.default.existsSync(this.auditLedgerPath)) {
            fs_1.default.writeFileSync(this.auditLedgerPath, JSON.stringify([]), "utf8");
        }
        // Ensure timeline ledger exists (for /api/timeline)
        this.ensureTimelineLedger();
    }
    // ---------------------------------------------------------------------------
    // AUDIT LEDGER (integrity-signed record system)
    // ---------------------------------------------------------------------------
    /**
     * Section L.4: Data Retrieval
     * Scans the audit ledger for all records associated with a specific PostWin.
     */
    getAuditTrail(postWinId) {
        const allRecords = this.loadAuditLedger();
        return allRecords.filter((record) => record.postWinId === postWinId);
    }
    /**
     * Section L.1 & L.3: Records status changes, signs them, and returns the full record
     */
    async commit(record) {
        const commitmentHash = this.generateHash(record);
        const sign = (0, crypto_1.createSign)("SHA256");
        sign.update(commitmentHash);
        const signature = sign.sign(this.privateKey, "hex");
        const fullRecord = {
            ...record,
            commitmentHash,
            signature,
        };
        const currentLedger = this.loadAuditLedger();
        currentLedger.push(fullRecord);
        this.atomicWriteJson(this.auditLedgerPath, currentLedger);
        return fullRecord;
    }
    /**
     * Section L.2: Deterministic SHA-256 Hashing
     */
    generateHash(data) {
        return (0, crypto_1.createHash)("sha256").update(JSON.stringify(data)).digest("hex");
    }
    /**
     * Section L.5: Verification Logic (audit ledger)
     */
    verifyLedgerIntegrity() {
        const records = this.loadAuditLedger();
        for (const record of records) {
            const { commitmentHash, signature, ...data } = record;
            if (this.generateHash(data) !== commitmentHash)
                return false;
            const verify = (0, crypto_1.createVerify)("SHA256");
            verify.update(commitmentHash);
            if (!verify.verify(this.publicKey, signature, "hex"))
                return false;
        }
        return true;
    }
    loadAuditLedger() {
        try {
            if (!fs_1.default.existsSync(this.auditLedgerPath))
                return [];
            const data = fs_1.default.readFileSync(this.auditLedgerPath, "utf8");
            return JSON.parse(data);
        }
        catch {
            return [];
        }
    }
    // ---------------------------------------------------------------------------
    // TIMELINE LEDGER (append-only events for project timeline + gap visibility)
    // ---------------------------------------------------------------------------
    /**
     * Append a timeline entry (append-only).
     * Used by delivery / follow-up intake handlers.
     */
    async appendEntry(entry) {
        const db = this.loadTimelineDb();
        db.entries.push(entry);
        this.atomicWriteJson(this.timelineLedgerPath, db);
    }
    /**
     * List all timeline entries for a projectId.
     * Used by /api/timeline/:projectId
     */
    async listByProject(projectId) {
        const db = this.loadTimelineDb();
        return db.entries.filter((e) => e?.projectId === projectId);
    }
    ensureTimelineLedger() {
        if (!fs_1.default.existsSync(this.timelineLedgerPath)) {
            const init = { entries: [] };
            this.atomicWriteJson(this.timelineLedgerPath, init);
        }
    }
    loadTimelineDb() {
        try {
            this.ensureTimelineLedger();
            const raw = fs_1.default.readFileSync(this.timelineLedgerPath, "utf8");
            const parsed = JSON.parse(raw);
            return {
                entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
            };
        }
        catch {
            return { entries: [] };
        }
    }
    // ---------------------------------------------------------------------------
    ensureDir(dir) {
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
    }
    /**
     * Atomic write prevents corrupted JSON if process crashes mid-write.
     */
    atomicWriteJson(filePath, data) {
        const tmp = `${filePath}.tmp`;
        fs_1.default.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
        fs_1.default.renameSync(tmp, filePath);
    }
}
exports.LedgerService = LedgerService;
