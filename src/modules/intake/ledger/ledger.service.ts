// apps/backend/src/modules/intake/ledger/ledger.service.ts
// Sovereign ledger authority with:
// - Cryptographic immutability
// - Structural supersession enforcement
// - Authority hierarchy enforcement
// - Deterministic replay guarantees
//
// This file is the constitutional boundary of governance.
// If this layer fails, institutional integrity fails.

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
import { getRequestId } from "@/lib/observability/request-context";
import { validateAuthoritySupersession } from "./authorityHierarchy.policy";

////////////////////////////////////////////////////////////////
// Errors
////////////////////////////////////////////////////////////////

/**
 * Thrown when input validation fails.
 * Represents boundary rejection — not governance conflict.
 */
export class LedgerValidationError extends Error {
  public readonly details: Record<string, string[] | undefined>;
  constructor(details: Record<string, string[] | undefined>) {
    super("Invalid ledger commit input");
    this.name = "LedgerValidationError";
    this.details = details;
  }
}

/**
 * Thrown when structural or authority-level supersession rules fail.
 * Represents constitutional conflict.
 */
export class LedgerSupersessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerSupersessionError";
  }
}

////////////////////////////////////////////////////////////////
// Validation Schema (Transport Boundary)
////////////////////////////////////////////////////////////////

/**
 * Validates transport-layer correctness.
 * Does NOT validate authority hierarchy.
 * Does NOT validate structural integrity.
 * Those are governance concerns handled later.
 */
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
    // HUMAN must always be attributable.
    if (data.actorKind === ActorKind.HUMAN && !data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "actorUserId required for HUMAN actor",
      });
    }

    // SYSTEM must never impersonate a user.
    if (data.actorKind === ActorKind.SYSTEM && data.actorUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorUserId"],
        message: "SYSTEM actor must not include userId",
      });
    }
  });

////////////////////////////////////////////////////////////////
// Ledger Service (Constitutional Core)
////////////////////////////////////////////////////////////////

export class LedgerService {
  private dataDir = path.join(process.cwd(), "data");
  private keysDir = path.join(this.dataDir, "keys");
  private privateKeyPath = path.join(this.keysDir, "private.pem");
  private publicKeyPath = path.join(this.keysDir, "public.pem");

  private privateKey: string;
  public publicKey: string;

  /**
   * Initializes cryptographic authority.
   * Keys are persisted to disk.
   * If keys change, historical verification fails.
   */
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
  // Commit — Constitutional Entry Point
  ////////////////////////////////////////////////////////////////

  /**
   * Commits an immutable governance event.
   *
   * Layered protections:
   * 1. Transport validation
   * 2. Structural supersession integrity
   * 3. Authority hierarchy validation
   * 4. Global logical clock allocation
   * 5. Canonical hash + signature
   * 6. Append-only persistence
   */
  public async commit(input: unknown, tx?: Prisma.TransactionClient) {
    const parsed = LedgerCommitSchema.safeParse(input);

    if (!parsed.success) {
      throw new LedgerValidationError(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;
    const db = tx ?? prisma;

    ////////////////////////////////////////////////////////////////
    // Structural Supersession Integrity
    ////////////////////////////////////////////////////////////////

    /**
     * Supersession protects authority lineage.
     * Without it, override chains become corruptible.
     */
    if (data.supersedesCommitId) {
      const target = await db.ledgerCommit.findUnique({
        where: { id: data.supersedesCommitId },
        select: {
          id: true,
          tenantId: true,
          supersededBy: { select: { id: true } },
          supersedesCommitId: true,
          actorKind: true,
          authorityProof: true,
        },
      });

      // Target must exist.
      if (!target) {
        throw new LedgerSupersessionError("SUPERSEDED_COMMIT_NOT_FOUND");
      }

      // No cross-tenant overrides.
      if (target.tenantId !== data.tenantId) {
        throw new LedgerSupersessionError(
          "CROSS_TENANT_SUPERSESSION_FORBIDDEN",
        );
      }

      // No double overrides.
      if (target.supersededBy) {
        throw new LedgerSupersessionError("COMMIT_ALREADY_SUPERSEDED");
      }

      // Prevent circular authority lineage.
      let cursorId: string | null = target.supersedesCommitId ?? null;

      while (cursorId) {
        const parent = await db.ledgerCommit.findUnique({
          where: { id: cursorId },
          select: { supersedesCommitId: true },
        });

        if (!parent?.supersedesCommitId) break;

        if (parent.supersedesCommitId === data.supersedesCommitId) {
          throw new LedgerSupersessionError("CIRCULAR_SUPERSESSION_DETECTED");
        }

        cursorId = parent.supersedesCommitId;
      }

      ////////////////////////////////////////////////////////////////
      // Authority Hierarchy Enforcement
      ////////////////////////////////////////////////////////////////

      /**
       * Structural integrity prevents corruption.
       * Hierarchy enforcement prevents illegitimate power escalation.
       */
      try {
        validateAuthoritySupersession({
          newActorKind: data.actorKind,
          newAuthorityProof: data.authorityProof,
          targetActorKind: target.actorKind,
          targetAuthorityProof: target.authorityProof,
        });
      } catch (e: any) {
        throw new LedgerSupersessionError(e.message);
      }
    }

    ////////////////////////////////////////////////////////////////
    // Sovereign Logical Clock
    ////////////////////////////////////////////////////////////////

    /**
     * Ordering is database-sovereign.
     * This guarantees global monotonicity.
     */
    const [{ nextval }] = await db.$queryRaw<
      { nextval: bigint }[]
    >`SELECT nextval('ledger_global_seq')`;

    const tsBigInt = nextval;

    ////////////////////////////////////////////////////////////////
    // Canonical Authoritative Normalization
    ////////////////////////////////////////////////////////////////

    /**
     * requestId is excluded from hashing.
     * Observability must never contaminate authority.
     */
    const authoritative = {
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

    const commitmentHash = this.generateHash(authoritative);

    /**
     * Signature binds institutional authority to commitmentHash.
     * If signature fails, history cannot be trusted.
     */
    const sign = createSign("SHA256");
    sign.update(commitmentHash);
    const signature = sign.sign(this.privateKey, "hex");

    ////////////////////////////////////////////////////////////////
    // Append-Only Persistence
    ////////////////////////////////////////////////////////////////

    return db.ledgerCommit.create({
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
        requestId: getRequestId() ?? null,
        commitmentHash,
        signature,
        supersedesCommitId: data.supersedesCommitId ?? null,
      },
    });
  }

  ////////////////////////////////////////////////////////////////
  // Hash Utilities
  ////////////////////////////////////////////////////////////////

  /**
   * Deterministic hashing.
   * Canonical JSON ensures replay stability.
   */
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

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// This layer is the constitutional boundary of institutional authority.
//
// Supersession integrity protects structural lineage:
// - No cross-tenant overrides
// - No double overrides
// - No circular ancestry
//
// Authority hierarchy protects legitimacy of power:
// - Lower authority cannot supersede higher authority
// - SYSTEM automation cannot silently override human escalation
// - Executive override requires explicit authority proof
//
// These rules are enforced at commit-time, not in services,
// ensuring governance cannot be bypassed through domain logic.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// 1. Transport validation (schema boundary)
// 2. Structural supersession integrity
// 3. Authority hierarchy validation
// 4. Sovereign logical clock allocation
// 5. Canonical normalization + SHA-256 hashing
// 6. RSA signature binding
// 7. Append-only persistence
//
// Each layer addresses a different class of institutional risk.

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Map LedgerValidationError to HTTP 400 (invalid request).
// - Map LedgerSupersessionError to HTTP 409 (governance conflict).
// - AuthorityProof must follow a controlled vocabulary or policy.
// - Never weaken supersession or hierarchy enforcement inside services.
// - Replay verification logic must stay aligned with canonical normalization.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Authority lineage is now structurally provable and hierarchy-constrained.
// Override chains can be reconstructed deterministically.
// Governance can scale across tenants without risking privilege escalation.
// This enables regulator-grade audits, executive review,
// and long-term institutional durability under concurrency.
////////////////////////////////////////////////////////////////
