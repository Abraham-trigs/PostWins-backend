// apps/backend/src/modules/intake/ledger/ledger.service.ts
// Sovereign ledger authority with cryptographic integrity + operational health observability.

import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
} from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { LedgerEventType, ActorKind, Prisma } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Errors
////////////////////////////////////////////////////////////////

export class LedgerValidationError extends Error {
  public readonly details: Record<string, string[] | undefined>;
  constructor(details: Record<string, string[] | undefined>) {
    super("Invalid ledger commit input");
    this.name = "LedgerValidationError";
    this.details = details;
  }
}

////////////////////////////////////////////////////////////////
// Validation Schema
////////////////////////////////////////////////////////////////

const LedgerCommitSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid().nullable().optional(),
    eventType: z.nativeEnum(LedgerEventType),
    actorKind: z.nativeEnum(ActorKind),
    actorUserId: z.string().uuid().nullable().optional(),
    authorityProof: z.string().min(1),
    intentContext: z.unknown().optional(),
    payload: z.unknown().optional(),
    supersedesCommitId: z.string().uuid().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.actorKind === ActorKind.HUMAN && !data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "actorUserId required for HUMAN actor",
      });
    }
    if (data.actorKind === ActorKind.SYSTEM && data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "SYSTEM actor must not include userId",
      });
    }
  });

export type LedgerCommitInput = z.infer<typeof LedgerCommitSchema>;

export type LedgerHealth = {
  status: "HEALTHY" | "CORRUPTED";
  checkedAt: number;
  recordCount: number;
  lastTs: string | null;
  sequenceExists: boolean;
  sequenceDrift: string | null;
  hashIntegrityVerified: boolean;
};

////////////////////////////////////////////////////////////////
// Ledger Service
////////////////////////////////////////////////////////////////

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

  ////////////////////////////////////////////////
  // Commit (Authoritative + Transaction-Aware)
  ////////////////////////////////////////////////

  public async commit(input: unknown, tx?: Prisma.TransactionClient) {
    const parsed = LedgerCommitSchema.safeParse(input);

    if (!parsed.success) {
      throw new LedgerValidationError(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;

    const db = tx ?? prisma;

    const [{ nextval }] = await db.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('ledger_global_seq')`;

    const tsBigInt = nextval;

    const normalized = {
      tenantId: data.tenantId,
      caseId: data.caseId ?? null,
      eventType: data.eventType,
      ts: tsBigInt.toString(),
      actorKind: data.actorKind,
      actorUserId: data.actorUserId ?? null,
      authorityProof: data.authorityProof,
      intentContext: data.intentContext ?? null,
      supersedesCommitId: data.supersedesCommitId ?? null,
      payload: data.payload ?? {},
    };

    const commitmentHash = this.generateHash(normalized);

    const sign = createSign("SHA256");
    sign.update(commitmentHash);
    const signature = sign.sign(this.privateKey, "hex");

    try {
      return await db.ledgerCommit.create({
        data: {
          tenantId: data.tenantId,
          caseId: data.caseId ?? null,
          eventType: data.eventType,
          ts: tsBigInt,
          actorKind: data.actorKind,
          actorUserId: data.actorUserId ?? null,
          authorityProof: data.authorityProof,
          intentContext: data.intentContext as any,
          payload: (data.payload ?? {}) as any,
          commitmentHash,
          signature,
          supersedesCommitId: data.supersedesCommitId ?? null,
        },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        return db.ledgerCommit.findUniqueOrThrow({
          where: { commitmentHash },
        });
      }
      throw err;
    }
  }

  ////////////////////////////////////////////////////////////////
  // Integrity Verification
  ////////////////////////////////////////////////////////////////

  public async verifyLedgerIntegrity(): Promise<boolean> {
    const records = await prisma.ledgerCommit.findMany({
      orderBy: { ts: "asc" },
    });

    let previousTs: bigint | null = null;

    for (const r of records) {
      if (previousTs !== null && r.ts <= previousTs) return false;
      previousTs = r.ts;

      const reconstructed = {
        tenantId: r.tenantId,
        caseId: r.caseId ?? null,
        eventType: r.eventType,
        ts: r.ts.toString(),
        actorKind: r.actorKind,
        actorUserId: r.actorUserId ?? null,
        authorityProof: r.authorityProof,
        intentContext: r.intentContext ?? null,
        supersedesCommitId: r.supersedesCommitId ?? null,
        payload: r.payload,
      };

      if (this.generateHash(reconstructed) !== r.commitmentHash) return false;

      const verify = createVerify("SHA256");
      verify.update(r.commitmentHash);

      if (!verify.verify(this.publicKey, r.signature, "hex")) return false;
    }

    return true;
  }

  ////////////////////////////////////////////////////////////////
  // Health (Operational Observability)
  ////////////////////////////////////////////////////////////////

  public async getHealth(): Promise<LedgerHealth> {
    const checkedAt = Date.now();
    const recordCount = await prisma.ledgerCommit.count();

    const last = await prisma.ledgerCommit.findFirst({
      orderBy: { ts: "desc" },
      select: { ts: true },
    });

    const integrityOk = await this.verifyLedgerIntegrity();

    let sequenceExists = true;
    let sequenceDrift: string | null = null;

    try {
      const [{ last_value }] = await prisma.$queryRaw<
        { last_value: bigint }[]
      >`SELECT last_value FROM ledger_global_seq`;

      if (last?.ts) {
        const drift = last_value - last.ts;
        sequenceDrift = drift.toString();
      }
    } catch {
      sequenceExists = false;
    }

    return {
      status: integrityOk ? "HEALTHY" : "CORRUPTED",
      checkedAt,
      recordCount,
      lastTs: last?.ts?.toString() ?? null,
      sequenceExists,
      sequenceDrift,
      hashIntegrityVerified: integrityOk,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Hashing
  ////////////////////////////////////////////////////////////////

  private generateHash(data: unknown): string {
    return createHash("sha256").update(this.canonicalize(data)).digest("hex");
  }

  private canonicalize(value: any): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((v) => this.canonicalize(v)).join(",")}]`;
    }

    const keys = Object.keys(value).sort();

    return `{${keys
      .map((k) => JSON.stringify(k) + ":" + this.canonicalize(value[k]))
      .join(",")}}`;
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ////////////////////////////////////////////////////////////////
// // Example Usage
// ////////////////////////////////////////////////////////////////

// /*
// const ledger = new LedgerService();

// await ledger.commit({
//   tenantId: "uuid",
//   caseId: "uuid",
//   eventType: LedgerEventType.ROUTED,
//   actorKind: ActorKind.SYSTEM,
//   authorityProof: "routing-engine-v1",
//   payload: { from: "INTAKE", to: "ROUTED" },
// });

// const health = await ledger.getHealth();
// console.log(health.status);
// */

// ////////////////////////////////////////////////////////////////
// // Design reasoning
// ////////////////////////////////////////////////////////////////
// Ledger is sovereign authority. It never mutates event intent.
// Schema enums define legality. Sequence guarantees deterministic ordering.
// Integrity verification proves immutability. Health endpoint provides
// operational observability without weakening authority.

// ////////////////////////////////////////////////////////////////
// // Structure
// ////////////////////////////////////////////////////////////////
// - Zod validation boundary
// - Typed LedgerValidationError
// - Global sequence allocation
// - Canonical hashing
// - RSA signature over commitment hash
// - Integrity replay verification
// - Operational health endpoint

// ////////////////////////////////////////////////////////////////
// // Implementation guidance
// ////////////////////////////////////////////////////////////////
// Route layer must catch LedgerValidationError and map to HTTP 400.
// Never mutate eventType inside ledger.
// Ensure ledger_global_seq exists in DB migration.

// ////////////////////////////////////////////////////////////////
// // Scalability insight
// ////////////////////////////////////////////////////////////////
// Global sequence preserves sovereign ordering.
// Health endpoint enables regulator-grade audit observability.
// Explicit enum binding prevents governance drift in Phase 2.
