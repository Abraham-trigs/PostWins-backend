/**
 * IMPORTANT LEDGER BOUNDARY
 *
 * - LedgerCommit records immutable facts only.
 * - It MUST NOT infer or encode workflow, lifecycle, or task semantics.
 * - TaskId (currentTask) is a Case field and is NEVER derived from ledger data.
 * - Legacy fields (action, previousState, newState) are transport metadata only.
 *
 * The ledger must never become a shadow workflow engine.
 */

import {
  createHash,
  createSign,
  createVerify,
  generateKeyPairSync,
} from "crypto";
import fs from "fs";
import path from "path";
import { prisma } from "../../lib/prisma";
import { assertUuid } from "../../utils/uuid";

import {
  LedgerHealth,
  LedgerAuditRecord,
  LedgerCommitInput,
  ActorKind,
  LEDGER_EVENT_TYPES,
} from "./types/ledger.types";

/* -------------------------------------------------------------------------- */
/* Local enum-safe guards / mappers                                            */
/* -------------------------------------------------------------------------- */

function mapActorKind(input: unknown): ActorKind {
  return input === "HUMAN" ? "HUMAN" : "SYSTEM";
}

function mapEventType(input: unknown, fallbackFromAction?: unknown) {
  const raw = String(input ?? "").trim();

  if (LEDGER_EVENT_TYPES.has(raw as any)) {
    return raw as any;
  }

  const action = String(fallbackFromAction ?? "").trim();

  /**
   * Legacy controller → factual ledger event mapping.
   * These are transport-era labels, NOT workflow semantics.
   */
  if (raw === "POSTWIN_BOOTSTRAPPED" || action === "INTAKE") {
    return "CASE_CREATED";
  }

  if (raw === "DELIVERY_RECORDED" || raw === "FOLLOWUP_RECORDED") {
    return "CASE_UPDATED";
  }

  return "CASE_UPDATED";
}

/* -------------------------------------------------------------------------- */
/* Ledger Service                                                             */
/* -------------------------------------------------------------------------- */

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

  /* ------------------------------------------------------------------------ */
  /* Health                                                                   */
  /* ------------------------------------------------------------------------ */

  public async getStatus(): Promise<LedgerHealth> {
    const checkedAt = Date.now();
    const recordCount = await prisma.ledgerCommit.count();
    const ok = await this.verifyLedgerIntegrity();

    return {
      status: ok ? "HEALTHY" : "CORRUPTED",
      checkedAt,
      recordCount,
      publicKeyPresent: Boolean(this.publicKey),
      note: ok
        ? undefined
        : "Ledger integrity check failed (hash/signature mismatch).",
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Audit / Projections                                                      */
  /* ------------------------------------------------------------------------ */

  public async getAuditTrail(postWinId: string): Promise<LedgerAuditRecord[]> {
    const rows = await prisma.ledgerCommit.findMany({
      where: {
        payload: {
          path: ["postWinId"],
          equals: postWinId,
        },
      },
      orderBy: { ts: "asc" },
      select: {
        ts: true,
        tenantId: true,
        caseId: true,
        eventType: true,
        actorKind: true,
        actorUserId: true,
        payload: true,
        commitmentHash: true,
        signature: true,
      },
    });

    return rows.map((r) => ({
      ts: Number(r.ts),
      tenantId: r.tenantId,
      caseId: r.caseId,
      eventType: String(r.eventType),
      actorKind: String(r.actorKind),
      actorUserId: r.actorUserId,
      payload: r.payload,
      commitmentHash: r.commitmentHash,
      signature: r.signature,

      // legacy transport metadata (projection-only)
      action: (r.payload as any)?.action ?? undefined,
      actorId: (r.payload as any)?.actorId ?? undefined,
      previousState: (r.payload as any)?.previousState ?? undefined,
      newState: (r.payload as any)?.newState ?? undefined,
      postWinId: (r.payload as any)?.postWinId ?? undefined,
    }));
  }

  /* ------------------------------------------------------------------------ */
  /* Back-compat wrappers                                                     */
  /* ------------------------------------------------------------------------ */

  public async appendEntry(entry: any) {
    const tenantId = String(entry?.tenantId ?? entry?.payload?.tenantId ?? "");
    assertUuid(tenantId, "tenantId");

    const maybeCaseId = entry?.caseId ?? entry?.projectId ?? null;
    const caseId = maybeCaseId == null ? null : String(maybeCaseId);
    if (caseId) assertUuid(caseId, "caseId");

    const ts = BigInt(
      typeof entry?.ts === "number"
        ? entry.ts
        : Date.parse(
            entry?.recordedAt ?? entry?.occurredAt ?? new Date().toISOString(),
          ),
    );

    const maybeActorUserId =
      entry?.integrity?.actorUserId ??
      entry?.actorUserId ??
      entry?.integrity?.actorId ??
      null;

    const actorUserId = maybeActorUserId ? String(maybeActorUserId) : null;
    if (actorUserId) assertUuid(actorUserId, "actorUserId");

    return this.commit({
      ts,
      tenantId,
      caseId,
      eventType: mapEventType(entry?.eventType ?? entry?.type),
      actorKind: mapActorKind(entry?.actorKind),
      actorUserId,
      payload: entry?.payload ?? entry,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Commit                                                                   */
  /* ------------------------------------------------------------------------ */

  public async commit(input: LedgerCommitInput) {
    const tenantId = String(input.tenantId ?? "");
    assertUuid(tenantId, "tenantId");

    const caseId = input.caseId == null ? null : String(input.caseId);
    if (caseId) assertUuid(caseId, "caseId");

    const actorUserId =
      input.actorUserId == null ? null : String(input.actorUserId);
    if (actorUserId) assertUuid(actorUserId, "actorUserId");

    const eventType = mapEventType(input.eventType, input.action);
    const actorKind = mapActorKind(input.actorKind);

    const payload =
      input.payload ??
      ({
        postWinId: input.postWinId ?? null,
        action: input.action ?? null,
        actorId: input.actorId ?? null,
        previousState: input.previousState ?? null,
        newState: input.newState ?? null,
      } as const);

    const commitmentHash = this.generateCommitmentHash({
      ...input,
      tenantId,
      caseId,
      eventType,
      actorKind,
      actorUserId,
      payload,
    });

    const sign = createSign("SHA256");
    sign.update(commitmentHash);
    const signature = sign.sign(this.privateKey, "hex");

    return prisma.ledgerCommit.create({
      data: {
        tenantId,
        caseId,
        eventType: eventType as any,
        ts: BigInt(input.ts),
        actorKind: actorKind as any,
        actorUserId,
        payload: payload as any,
        commitmentHash,
        signature,
        supersedesCommitId: input.supersedesCommitId ?? null,
      },
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Integrity                                                                */
  /* ------------------------------------------------------------------------ */

  public async verifyLedgerIntegrity(): Promise<boolean> {
    const records = await prisma.ledgerCommit.findMany({
      orderBy: { ts: "asc" },
      select: {
        tenantId: true,
        caseId: true,
        eventType: true,
        ts: true,
        actorKind: true,
        actorUserId: true,
        payload: true,
        supersedesCommitId: true,
        commitmentHash: true,
        signature: true,
      },
    });

    for (const r of records) {
      const reconstructed = {
        tenantId: r.tenantId,
        caseId: r.caseId ?? null,
        eventType: String(r.eventType),
        ts: Number(r.ts),
        actorKind: String(r.actorKind),
        actorUserId: r.actorUserId ?? null,
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

  /* ------------------------------------------------------------------------ */
  /* Hashing                                                                  */
  /* ------------------------------------------------------------------------ */

  private generateCommitmentHash(input: LedgerCommitInput): string {
    return this.generateHash({
      tenantId: input.tenantId,
      caseId: input.caseId ?? null,
      eventType: input.eventType ?? input.action ?? "LEGACY_EVENT",
      ts: Number(input.ts),
      actorKind: input.actorKind ?? "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      supersedesCommitId: input.supersedesCommitId ?? null,
      payload: input.payload,
    });
  }

  private generateHash(data: unknown): string {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  /* ------------------------------------------------------------------------ */
  /* FS                                                                       */
  /* ------------------------------------------------------------------------ */

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
