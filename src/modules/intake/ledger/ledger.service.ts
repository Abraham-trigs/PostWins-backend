// apps/backend/src/modules/intake/ledger/ledger.service.ts
// Purpose: Sovereign ledger authority responsible for immutable event commits,
// cryptographic signatures, deterministic canonicalization, idempotent commit safety,
// and read projections for audit, timeline, and health checks.

/*
Assumptions
- Prisma schema contains `ledgerCommit` model with fields used here.
- Postgres sequence `ledger_global_seq` exists.
- Unique index exists on (tenantId, requestId) for idempotency.
- Prisma client exported from "@/lib/prisma".
- Request context helper exists at "@/lib/observability/request-context".
- Authority validation exists in "./authorityHierarchy.policy".
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
The ledger is the constitutional write boundary of the system. Every mutation flows
through this service so the system guarantees immutability, deterministic ordering,
cryptographic integrity, and replay safety.

This implementation preserves the improved atomic commit pipeline introduced in
the new version (idempotency, canonical hashing, DB-backed conflict detection)
while restoring the public read APIs (`getAuditTrail`, `listByProject`, `getStatus`)
required by downstream modules such as analytics, timeline, and health.

The service separates responsibilities:
- Zod validation ensures runtime correctness before any write.
- Canonical JSON serialization ensures deterministic hashes.
- RSA signatures protect commit integrity.
- DB uniqueness constraints enforce idempotency and supersession safety.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- LedgerService
- LedgerValidationError
- LedgerSupersessionError

Main responsibilities
- appendEntry(): public mutation entrypoint
- commit(): internal deterministic commit pipeline
- getAuditTrail(): chronological case events
- listByProject(): project-linked ledger projection
- getStatus(): operational health snapshot
*/

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

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
// JSON Validation Schema
////////////////////////////////////////////////////////////////

const JsonValueSchema: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

const LedgerCommitSchema = z
  .object({
    tenantId: z.string().uuid(),
    caseId: z.string().uuid().nullable().optional(),
    eventType: z.nativeEnum(LedgerEventType),
    actorKind: z.nativeEnum(ActorKind),
    actorUserId: z.string().uuid().nullable().optional(),
    authorityProof: z.string().min(1),
    intentContext: JsonValueSchema.optional(),
    payload: JsonValueSchema.optional(),
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

    if (
      fs.existsSync(this.privateKeyPath) &&
      fs.existsSync(this.publicKeyPath)
    ) {
      this.privateKey = fs.readFileSync(this.privateKeyPath, "utf8");
      this.publicKey = fs.readFileSync(this.publicKeyPath, "utf8");
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

      fs.writeFileSync(this.privateKeyPath, this.privateKey);
      fs.writeFileSync(this.publicKeyPath, this.publicKey);
    }
  }

  ////////////////////////////////////////////////////////////////
  // Public Mutation API
  ////////////////////////////////////////////////////////////////

  public async appendEntry(input: unknown, tx?: Prisma.TransactionClient) {
    return this.commit(input, tx);
  }

  ////////////////////////////////////////////////////////////////
  // Public Read APIs (required by analytics/timeline/health)
  ////////////////////////////////////////////////////////////////

  public async getAuditTrail(caseId: string) {
    return prisma.ledgerCommit.findMany({
      where: { caseId },
      orderBy: { ts: "asc" },
    });
  }

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

  public async getStatus() {
    const latest = await prisma.ledgerCommit.findFirst({
      orderBy: { ts: "desc" },
      select: { ts: true },
    });

    return {
      ok: true,
      latestCommitTs: latest?.ts ? latest.ts.toString() : null,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Core Commit Pipeline
  ////////////////////////////////////////////////////////////////

  private async commit(input: unknown, tx?: Prisma.TransactionClient) {
    const parsed = LedgerCommitSchema.safeParse(input);

    if (!parsed.success) {
      throw new LedgerValidationError(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;
    const db = tx ?? prisma;
    const requestId = getRequestId();

    ////////////////////////////////////////////////////////////////
    // Supersession Validation
    ////////////////////////////////////////////////////////////////

    if (data.supersedesCommitId) {
      const target = await db.ledgerCommit.findUnique({
        where: { id: data.supersedesCommitId },
        select: {
          tenantId: true,
          supersededBy: { select: { id: true } },
          actorKind: true,
          authorityProof: true,
        },
      });

      if (!target)
        throw new LedgerSupersessionError("SUPERSEDED_COMMIT_NOT_FOUND");

      if (target.tenantId !== data.tenantId)
        throw new LedgerSupersessionError(
          "CROSS_TENANT_SUPERSESSION_FORBIDDEN",
        );

      if (target.supersededBy)
        throw new LedgerSupersessionError("COMMIT_ALREADY_SUPERSEDED");

      validateAuthoritySupersession({
        newActorKind: data.actorKind,
        newAuthorityProof: data.authorityProof,
        targetActorKind: target.actorKind,
        targetAuthorityProof: target.authorityProof,
      });
    }

    ////////////////////////////////////////////////////////////////
    // Deterministic Sequence
    ////////////////////////////////////////////////////////////////

    const [{ nextval }] = await db.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('ledger_global_seq')`;

    ////////////////////////////////////////////////////////////////
    // Authoritative Hash Payload
    ////////////////////////////////////////////////////////////////

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

    const signer = createSign("SHA256");
    signer.update(commitmentHash);
    const signature = signer.sign(this.privateKey, "hex");

    ////////////////////////////////////////////////////////////////
    // Atomic Write with Idempotency
    ////////////////////////////////////////////////////////////////

    try {
      return await db.ledgerCommit.create({
        data: {
          ...authoritative,
          ts: nextval,
          intentContext:
            authoritative.intentContext === null
              ? Prisma.JsonNull
              : authoritative.intentContext,
          requestId,
          commitmentHash,
          signature,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        const target = (e.meta?.target as string[]) || [];

        if (
          target.includes("tenantId") &&
          target.includes("requestId") &&
          requestId
        ) {
          return db.ledgerCommit.findFirstOrThrow({
            where: { tenantId: data.tenantId, requestId },
          });
        }

        if (target.includes("supersedesCommitId")) {
          throw new LedgerSupersessionError("COMMIT_ALREADY_SUPERSEDED");
        }
      }

      throw e;
    }
  }

  ////////////////////////////////////////////////////////////////
  // Canonical Hashing
  ////////////////////////////////////////////////////////////////

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

  private generateHash(data: unknown): string {
    return createHash("sha256").update(this.canonicalize(data)).digest("hex");
  }

  ////////////////////////////////////////////////////////////////
  // Utilities
  ////////////////////////////////////////////////////////////////

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Example usage inside intake controller:

await ledgerService.appendEntry({
  tenantId,
  caseId,
  eventType: LedgerEventType.CASE_CREATED,
  actorKind: ActorKind.HUMAN,
  actorUserId: user.id,
  authorityProof: "case:create",
  payload: { projectId, title }
});
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
As ledger volume grows, projections such as timelines, analytics,
and dashboards should be served from read models or event
projections instead of direct ledger queries. The ledger itself
should remain append-only and optimized strictly for correctness.
*/
