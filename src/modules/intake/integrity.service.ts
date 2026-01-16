import { IntegrityFlag, PostWin } from "@posta/core";
import fs from "fs";
import path from "path";

type IdempotencyDb = {
  keys: Record<
    string,
    {
      requestHash: string;
      response: unknown;
      recordedAt: string;
    }
  >;
};

export class IntegrityService {
  private processedHashes = new Set<string>();
  private deviceRegistry = new Map<string, string[]>();
  private lastActivity = new Map<string, number>();
  private violationCounters = new Map<string, number>(); // Section M.5: Tracks HIGH severity counts
  private blacklist = new Set<string>(); // Section M.5: Permanent ban list

  // IMPORTANT: use process.cwd() (works in dev + dist builds)
  private registryPath = path.join(process.cwd(), "device_registry.json");
  private blacklistPath = path.join(process.cwd(), "blacklist.json");

  // NEW: idempotency persistence (used by idempotency.middleware.ts)
  private dataDir = path.join(process.cwd(), "data");
  private idempotencyPath = path.join(this.dataDir, "idempotency.json");

  private readonly COOLDOWN_MS = 30000;
  private readonly MAX_VIOLATIONS = 5;

  constructor() {
    this.ensureDir(this.dataDir);
    this.ensureIdempotencyFile();

    this.loadRegistry();
    this.loadBlacklist();
  }

  /**
   * Section F & M: Multi-layered integrity check with Blacklist Enforcement
   */
  public async performFullAudit(
    postWin: PostWin,
    rawMessage: string,
    deviceId?: string
  ): Promise<IntegrityFlag[]> {
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

    const flags: IntegrityFlag[] = [];

    // 2. Rate Limit / Cooldown Check (Section M.4)
    if (deviceId) {
      const cooldownFlag = this.checkCooldown(deviceId);
      if (cooldownFlag) flags.push(cooldownFlag);
    }

    // 3. Basic Duplicate Check (Section F)
    const duplicate = this.checkDuplicate(rawMessage);
    if (duplicate) flags.push(duplicate);

    // 4. Ghost Beneficiary Detection (Section M.1)
    if (deviceId) {
      const ghostFlag = this.detectGhostBeneficiary(deviceId, postWin.beneficiaryId);
      if (ghostFlag) flags.push(ghostFlag);
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

  private handleViolation(deviceId: string): void {
    const count = (this.violationCounters.get(deviceId) || 0) + 1;
    this.violationCounters.set(deviceId, count);

    if (count >= this.MAX_VIOLATIONS) {
      this.blacklist.add(deviceId);
      this.saveBlacklist();
    }
  }

  private checkCooldown(deviceId: string): IntegrityFlag | null {
    const now = Date.now();
    const lastTime = this.lastActivity.get(deviceId) || 0;
    if (now - lastTime < this.COOLDOWN_MS) {
      return { type: "SUSPICIOUS_TONE", severity: "LOW", timestamp: now };
    }
    this.lastActivity.set(deviceId, now);
    return null;
  }

  public checkDuplicate(message: string): IntegrityFlag | null {
    const hash = message.toLowerCase().trim();
    if (this.processedHashes.has(hash)) {
      return { type: "DUPLICATE_CLAIM", severity: "HIGH", timestamp: Date.now() };
    }
    this.processedHashes.add(hash);
    return null;
  }

  private detectGhostBeneficiary(deviceId: string, beneficiaryId: string): IntegrityFlag | null {
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

  private isAdversarial(message: string): boolean {
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
  public async get(key: string): Promise<{ requestHash: string; response: unknown } | null> {
    const db = this.loadIdempotency();
    const record = db.keys[key];
    if (!record) return null;
    return { requestHash: record.requestHash, response: record.response };
  }

  /**
   * Save an idempotency record (key -> requestHash + response).
   * This allows safe retry + replay across restarts.
   */
  public async save(key: string, requestHash: string, response: unknown): Promise<void> {
    const db = this.loadIdempotency();
    db.keys[key] = {
      requestHash,
      response,
      recordedAt: new Date().toISOString(),
    };
    this.writeIdempotency(db);
  }

  private ensureIdempotencyFile(): void {
    try {
      if (!fs.existsSync(this.idempotencyPath)) {
        const init: IdempotencyDb = { keys: {} };
        fs.writeFileSync(this.idempotencyPath, JSON.stringify(init, null, 2));
      }
    } catch (e) {
      // If this fails, idempotency becomes best-effort (but we try hard to persist).
      console.error("Idempotency store init failed:", e);
    }
  }

  private loadIdempotency(): IdempotencyDb {
    try {
      if (!fs.existsSync(this.idempotencyPath)) return { keys: {} };
      const raw = fs.readFileSync(this.idempotencyPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        keys: typeof parsed?.keys === "object" && parsed?.keys ? parsed.keys : {},
      };
    } catch {
      return { keys: {} };
    }
  }

  private writeIdempotency(db: IdempotencyDb): void {
    try {
      fs.writeFileSync(this.idempotencyPath, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error("Idempotency store save failed:", e);
    }
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // --- Persistence Methods (existing) ---------------------------------------

  private saveRegistry(): void {
    try {
      const data = JSON.stringify(Object.fromEntries(this.deviceRegistry), null, 2);
      fs.writeFileSync(this.registryPath, data);
    } catch (e) {
      console.error("Registry save failed:", e);
    }
  }

  private saveBlacklist(): void {
    try {
      const data = JSON.stringify(Array.from(this.blacklist), null, 2);
      fs.writeFileSync(this.blacklistPath, data);
    } catch (e) {
      console.error("Blacklist save failed:", e);
    }
  }

  private loadRegistry(): void {
    try {
      if (fs.existsSync(this.registryPath)) {
        const data = JSON.parse(fs.readFileSync(this.registryPath, "utf8"));
        this.deviceRegistry = new Map(Object.entries(data));
      }
    } catch {
      this.deviceRegistry = new Map();
    }
  }

  private loadBlacklist(): void {
    try {
      if (fs.existsSync(this.blacklistPath)) {
        const data = JSON.parse(fs.readFileSync(this.blacklistPath, "utf8"));
        this.blacklist = new Set(data);
      }
    } catch {
      this.blacklist = new Set();
    }
  }
}
