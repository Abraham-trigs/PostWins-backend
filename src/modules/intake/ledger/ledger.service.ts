// apps/backend/src/modules/intake/ledger/ledger.service.ts
// Sovereign ledger authority with:
// - Cryptographic immutability
// - Structural supersession enforcement
// - Authority hierarchy enforcement
// - Deterministic replay guarantees
//
// This is the constitutional boundary of governance.
// Ledger is authority. Everything else is projection.

import { createHash, createSign, generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { LedgerEventType, ActorKind, Prisma } from "@prisma/client";
import { getRequestId } from "@/lib/observability/request-context";
import { validateAuthoritySupersession } from "./authorityHierarchy.policy";

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

export class LedgerSupersessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerSupersessionError";
  }
}

////////////////////////////////////////////////////////////////
// Transport Schema
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

  ////////////////////////////////////////////////////////////////
  // PUBLIC API — Stable Contract
  ////////////////////////////////////////////////////////////////

  /**
   * Stable external API.
   * Controllers/services should call appendEntry — not commit().
   */
  public async appendEntry(input: unknown, tx?: Prisma.TransactionClient) {
    return this.commit(input, tx);
  }

  /**
   * Returns ordered audit trail for a case.
   * Projection only — no mutation.
   */
  public async getAuditTrail(caseId: string) {
    return prisma.ledgerCommit.findMany({
      where: { caseId },
      orderBy: { ts: "asc" },
    });
  }

  /**
   * Returns entries grouped by project reference (if stored in payload).
   * This is projection logic only.
   */
  public async listByProject(projectId: string) {
    return prisma.ledgerCommit.findMany({
      where: {
        payload: {
          path: ["projectId"],
          equals: projectId,
        },
      },
      orderBy: { ts: "asc" },
    });
  }

  /**
   * Lightweight operational health status.
   * Does NOT expose authority material.
   *
   */
  public async getStatus() {
    const latest = await prisma.ledgerCommit.findFirst({
      orderBy: { ts: "desc" },
      select: { ts: true },
    });

    return {
      ok: true,
      latestCommitTs: latest?.ts ?? null,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Constitutional Commit
  ////////////////////////////////////////////////////////////////

  private async commit(input: unknown, tx?: Prisma.TransactionClient) {
    const parsed = LedgerCommitSchema.safeParse(input);

    if (!parsed.success) {
      throw new LedgerValidationError(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;
    const db = tx ?? prisma;

    if (data.supersedesCommitId) {
      const target = await db.ledgerCommit.findUnique({
        where: { id: data.supersedesCommitId },
        select: {
          id: true,
          tenantId: true,
          supersededBy: { select: { id: true } },
          actorKind: true,
          authorityProof: true,
        },
      });

      if (!target) {
        throw new LedgerSupersessionError("SUPERSEDED_COMMIT_NOT_FOUND");
      }

      if (target.tenantId !== data.tenantId) {
        throw new LedgerSupersessionError(
          "CROSS_TENANT_SUPERSESSION_FORBIDDEN",
        );
      }

      if (target.supersededBy) {
        throw new LedgerSupersessionError("COMMIT_ALREADY_SUPERSEDED");
      }

      validateAuthoritySupersession({
        newActorKind: data.actorKind,
        newAuthorityProof: data.authorityProof,
        targetActorKind: target.actorKind,
        targetAuthorityProof: target.authorityProof,
      });
    }

    const [{ nextval }] = await db.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('ledger_global_seq')`;

    const authoritative = {
      tenantId: data.tenantId,
      caseId: data.caseId ?? null,
      eventType: data.eventType,
      ts: nextval.toString(),
      actorKind: data.actorKind,
      actorUserId: data.actorUserId ?? null,
      authorityProof: data.authorityProof,
      intentContext: data.intentContext ?? null,
      supersedesCommitId: data.supersedesCommitId ?? null,
      payload: data.payload ?? {},
    };

    const commitmentHash = this.generateHash(authoritative);

    const sign = createSign("SHA256");
    sign.update(commitmentHash);
    const signature = sign.sign(this.privateKey, "hex");

    return db.ledgerCommit.create({
      data: {
        tenantId: data.tenantId,
        caseId: data.caseId ?? null,
        eventType: data.eventType,
        ts: nextval,
        actorKind: data.actorKind,
        actorUserId: data.actorUserId ?? null,
        authorityProof: data.authorityProof,
        intentContext: data.intentContext as any,
        payload: (data.payload ?? {}) as any,
        requestId: getRequestId() ?? null,
        commitmentHash,
        signature,
        supersedesCommitId: data.supersedesCommitId ?? null,
      },
    });
  }

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
