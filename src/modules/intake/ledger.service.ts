import { AuditRecord } from "@posta/core";
import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
} from "crypto";
import fs from "fs";
import path from "path";

type TimelineLedgerDb = {
  entries: any[]; // MVP: keep flexible (timeline.service uses `any` right now)
};

export class LedgerService {
  // ---- Paths (use process.cwd() so it works in dev + dist) ----
  private auditLedgerPath = path.join(process.cwd(), "audit_ledger.json");

  private dataDir = path.join(process.cwd(), "data");
  private timelineLedgerPath = path.join(this.dataDir, "ledger.json");

  private keysDir = path.join(this.dataDir, "keys");
  private privateKeyPath = path.join(this.keysDir, "private.pem");
  private publicKeyPath = path.join(this.keysDir, "public.pem");

  private privateKey: string;
  public publicKey: string;

  constructor() {
    // Ensure dirs exist
    this.ensureDir(this.dataDir);
    this.ensureDir(this.keysDir);

    // Load or create signing keys (CRITICAL: persist keys across restarts)
    const existingPriv = fs.existsSync(this.privateKeyPath)
      ? fs.readFileSync(this.privateKeyPath, "utf8")
      : null;

    const existingPub = fs.existsSync(this.publicKeyPath)
      ? fs.readFileSync(this.publicKeyPath, "utf8")
      : null;

    if (existingPriv && existingPub) {
      this.privateKey = existingPriv;
      this.publicKey = existingPub;
    } else {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });

      this.privateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
      this.publicKey = publicKey.export({ type: "spki", format: "pem" }) as string;

      fs.writeFileSync(this.privateKeyPath, this.privateKey, "utf8");
      fs.writeFileSync(this.publicKeyPath, this.publicKey, "utf8");
    }

    // Ensure audit ledger exists
    if (!fs.existsSync(this.auditLedgerPath)) {
      fs.writeFileSync(this.auditLedgerPath, JSON.stringify([]), "utf8");
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
  public getAuditTrail(postWinId: string): AuditRecord[] {
    const allRecords = this.loadAuditLedger();
    return allRecords.filter((record) => record.postWinId === postWinId);
  }

  /**
   * Section L.1 & L.3: Records status changes, signs them, and returns the full record
   */
  async commit(
    record: Omit<AuditRecord, "commitmentHash" | "signature">
  ): Promise<AuditRecord> {
    const commitmentHash = this.generateHash(record);

    const sign = createSign("SHA256");
    sign.update(commitmentHash);
    const signature = sign.sign(this.privateKey, "hex");

    const fullRecord: AuditRecord = {
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
  generateHash(data: any): string {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  /**
   * Section L.5: Verification Logic (audit ledger)
   */
  verifyLedgerIntegrity(): boolean {
    const records = this.loadAuditLedger();
    for (const record of records) {
      const { commitmentHash, signature, ...data } = record as any;
      if (this.generateHash(data) !== commitmentHash) return false;

      const verify = createVerify("SHA256");
      verify.update(commitmentHash);

      if (!verify.verify(this.publicKey, signature, "hex")) return false;
    }
    return true;
  }

  private loadAuditLedger(): AuditRecord[] {
    try {
      if (!fs.existsSync(this.auditLedgerPath)) return [];
      const data = fs.readFileSync(this.auditLedgerPath, "utf8");
      return JSON.parse(data);
    } catch {
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
  public async appendEntry(entry: any): Promise<void> {
    const db = this.loadTimelineDb();
    db.entries.push(entry);
    this.atomicWriteJson(this.timelineLedgerPath, db);
  }

  /**
   * List all timeline entries for a projectId.
   * Used by /api/timeline/:projectId
   */
  public async listByProject(projectId: string): Promise<any[]> {
    const db = this.loadTimelineDb();
    return db.entries.filter((e) => e?.projectId === projectId);
  }

  private ensureTimelineLedger() {
    if (!fs.existsSync(this.timelineLedgerPath)) {
      const init: TimelineLedgerDb = { entries: [] };
      this.atomicWriteJson(this.timelineLedgerPath, init);
    }
  }

  private loadTimelineDb(): TimelineLedgerDb {
    try {
      this.ensureTimelineLedger();
      const raw = fs.readFileSync(this.timelineLedgerPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
      };
    } catch {
      return { entries: [] };
    }
  }

  // ---------------------------------------------------------------------------

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * Atomic write prevents corrupted JSON if process crashes mid-write.
   */
  private atomicWriteJson(filePath: string, data: unknown) {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  }
}
