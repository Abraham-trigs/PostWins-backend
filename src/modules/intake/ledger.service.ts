import { AuditRecord as CoreAuditRecord } from "@posta/core";
import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
} from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "../../lib/prisma";

export class LedgerService {
  private dataDir = path.join(process.cwd(), "data");
  private keysDir = path.join(this.dataDir, "keys");
  private privateKeyPath = path.join(this.keysDir, "private.pem");
  private publicKeyPath = path.join(this.keysDir, "public.pem");

  private privateKey: string;
  public publicKey: string;

  constructor() {
    this.ensureDir(this.dataDir);
    this.ensureDir(this.keysDir);

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
      this.privateKey = privateKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string;
      this.publicKey = publicKey.export({
        type: "spki",
        format: "pem",
      }) as string;
      fs.writeFileSync(this.privateKeyPath, this.privateKey, "utf8");
      fs.writeFileSync(this.publicKeyPath, this.publicKey, "utf8");
    }
  }

  // --- AUDIT LEDGER ---

  public async getAuditTrail(postWinId: string): Promise<CoreAuditRecord[]> {
    const rows = await prisma.auditRecord.findMany({
      where: { postWinId },
      orderBy: { timestamp: "asc" },
    });

    // Shape rows into @posta/core AuditRecord shape
    return rows.map((r) => ({
      timestamp: Number(r.timestamp),
      postWinId: r.postWinId,
      action: r.action,
      actorId: r.actorId,
      previousState: r.previousState,
      newState: r.newState,
      commitmentHash: r.commitmentHash,
      signature: r.signature,
    }));
  }

  public async commit(
    record: Omit<CoreAuditRecord, "commitmentHash" | "signature">,
  ): Promise<CoreAuditRecord> {
    const commitmentHash = this.generateHash(record);

    const sign = createSign("SHA256");
    sign.update(commitmentHash);
    const signature = sign.sign(this.privateKey, "hex");

    const fullRecord: CoreAuditRecord = {
      ...record,
      commitmentHash,
      signature,
    };

    await prisma.auditRecord.create({
      data: {
        postWinId: fullRecord.postWinId,
        action: fullRecord.action,
        actorId: fullRecord.actorId,
        previousState: fullRecord.previousState,
        newState: fullRecord.newState,
        timestamp: BigInt(fullRecord.timestamp),
        commitmentHash: fullRecord.commitmentHash,
        signature: fullRecord.signature,
      },
    });

    return fullRecord;
  }

  public async verifyLedgerIntegrity(): Promise<boolean> {
    const records = await prisma.auditRecord.findMany({
      orderBy: { createdAt: "asc" },
    });

    for (const r of records) {
      const { commitmentHash, signature, ...data } = r as any;

      // Rebuild the original signed payload
      const reconstructed = {
        timestamp: Number(r.timestamp),
        postWinId: r.postWinId,
        action: r.action,
        actorId: r.actorId,
        previousState: r.previousState,
        newState: r.newState,
      };

      if (this.generateHash(reconstructed) !== commitmentHash) return false;

      const verify = createVerify("SHA256");
      verify.update(commitmentHash);

      if (!verify.verify(this.publicKey, signature, "hex")) return false;
    }

    return true;
  }

  public generateHash(data: any): string {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  // --- TIMELINE LEDGER ---

  public async appendEntry(entry: any): Promise<void> {
    await prisma.timelineEntry.create({
      data: {
        id: String(entry.id),
        projectId: String(entry.projectId),
        type: String(entry.type),
        occurredAt: new Date(entry.occurredAt),
        recordedAt: new Date(entry.recordedAt),
        integrity: entry.integrity ?? undefined,
        payload: entry.payload ?? undefined,
      },
    });
  }

  public async listByProject(projectId: string): Promise<any[]> {
    return prisma.timelineEntry.findMany({
      where: { projectId },
      orderBy: { recordedAt: "asc" },
    });
  }

  public async listByPostWinId(postWinId: string): Promise<any[]> {
    return prisma.timelineEntry.findMany({
      where: { payload: { path: ["postWinId"], equals: postWinId } },
      orderBy: { recordedAt: "asc" },
    });
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
