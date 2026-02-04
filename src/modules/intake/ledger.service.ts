// apps/backend/src/modules/intake/ledger.service.ts
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

type LedgerHealthStatus = "HEALTHY" | "CORRUPTED";

export type LedgerHealth = {
  status: LedgerHealthStatus;
  checkedAt: number;
  recordCount: number;
  publicKeyPresent: boolean;
  note?: string;
};

export type LedgerAuditRecord = {
  action?: string;
  newState?: string;
  previousState?: string;
  actorId?: string;
  actorKind?: string;
  ts?: number | bigint;
  [k: string]: any;
};

export type LedgerCommitInput = {
  // always provided by callers
  ts: number | bigint;

  // legacy fields (your controllers/services are sending these)
  postWinId?: string;
  action?: string;
  actorId?: string;
  previousState?: string;
  newState?: string;

  // new fields (schema-driven commit)
  tenantId?: string;
  caseId?: string | null;
  eventType?: string;
  actorKind?: string;
  actorUserId?: string | null;
  payload?: unknown;
  supersedesCommitId?: string | null;

  // allow any extras without type-fighting
  [k: string]: any;
};

// Local enum-safe guards/mappers (avoid Prisma enums imports everywhere)
type ActorKindEnum = "HUMAN" | "SYSTEM";
type LedgerEventTypeEnum =
  | "CASE_CREATED"
  | "CASE_UPDATED"
  | "CASE_FLAGGED"
  | "CASE_REJECTED"
  | "CASE_ARCHIVED"
  | "ROUTED"
  | "ROUTING_SUPERSEDED"
  | "VERIFICATION_SUBMITTED"
  | "VERIFIED"
  | "APPEAL_OPENED"
  | "APPEAL_RESOLVED"
  | "GRANT_CREATED"
  | "GRANT_POLICY_APPLIED"
  | "BUDGET_ALLOCATED"
  | "TRANCHE_RELEASED"
  | "BUDGET_SUPERSEDED"
  | "TRANCHE_REVERSED";

const LEDGER_EVENT_TYPES: Set<string> = new Set([
  "CASE_CREATED",
  "CASE_UPDATED",
  "CASE_FLAGGED",
  "CASE_REJECTED",
  "CASE_ARCHIVED",
  "ROUTED",
  "ROUTING_SUPERSEDED",
  "VERIFICATION_SUBMITTED",
  "VERIFIED",
  "APPEAL_OPENED",
  "APPEAL_RESOLVED",
  "GRANT_CREATED",
  "GRANT_POLICY_APPLIED",
  "BUDGET_ALLOCATED",
  "TRANCHE_RELEASED",
  "BUDGET_SUPERSEDED",
  "TRANCHE_REVERSED",
]);

function mapActorKind(input: unknown): ActorKindEnum {
  return input === "HUMAN" ? "HUMAN" : "SYSTEM";
}

function mapEventType(
  input: unknown,
  fallbackFromAction?: unknown,
): LedgerEventTypeEnum {
  const raw = String(input ?? "").trim();
  if (LEDGER_EVENT_TYPES.has(raw)) return raw as LedgerEventTypeEnum;

  const action = String(fallbackFromAction ?? "").trim();

  // legacy/controller values → schema LedgerEventType
  if (raw === "POSTWIN_BOOTSTRAPPED" || action === "INTAKE")
    return "CASE_CREATED";
  if (raw === "DELIVERY_RECORDED" || raw === "FOLLOWUP_RECORDED")
    return "CASE_UPDATED";

  return "CASE_UPDATED";
}

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

  /**
   * Used by GET /health/ledger
   */
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

  /**
   * Minimal “audit trail” by postWinId stored in payload (JSON path query).
   * Works with your schema: LedgerCommit.payload Json.
   */
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

      // legacy-friendly projections (so .action/.actorId compile everywhere)
      action: (r.payload as any)?.action ?? undefined,
      actorId: (r.payload as any)?.actorId ?? undefined,
      previousState: (r.payload as any)?.previousState ?? undefined,
      newState: (r.payload as any)?.newState ?? undefined,
      postWinId: (r.payload as any)?.postWinId ?? undefined,
    }));
  }

  /**
   * --------------------------------------------------------------------------
   * Back-compat wrappers (older controller/service call sites)
   * --------------------------------------------------------------------------
   */

  /**
   * Older code calls ledgerService.appendEntry(timelineEntry).
   * This now routes through commit() to ensure:
   * - UUID correctness for tenantId/caseId/actorUserId
   * - enum-safe actorKind + eventType mapping
   * - signature/hash always present so integrity checks pass
   */
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

    const actorKind = mapActorKind(entry?.actorKind);
    const eventType = mapEventType(entry?.eventType ?? entry?.type);

    return this.commit({
      ts,
      tenantId,
      caseId,
      eventType,
      actorKind,
      actorUserId,
      payload: entry?.payload ?? entry,
    });
  }

  /**
   * Older code calls listByProject(projectId).
   * Maps "project" → caseId.
   */
  public async listByProject(projectId: string) {
    return prisma.ledgerCommit.findMany({
      where: { caseId: String(projectId) },
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
  }

  /**
   * Older code calls listByPostWinId(postWinId).
   * Returns timeline-like rows where payload.postWinId == postWinId.
   */
  public async listByPostWinId(postWinId: string) {
    return prisma.ledgerCommit.findMany({
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
  }

  /**
   * Create a new LedgerCommit record with a deterministic hash + RSA signature.
   * Supports both legacy commits (action/actorId/previousState/newState/postWinId)
   * and schema-shaped commits (tenantId/caseId/eventType/actorKind/payload).
   *
   * IMPORTANT:
   * - tenantId MUST be a UUID (FK → Tenant.id)
   * - caseId/actorUserId if present MUST be UUIDs
   * - actorKind MUST be HUMAN|SYSTEM
   * - eventType MUST be a LedgerEventType enum value
   */
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

    const normalized: LedgerCommitInput = {
      ...input,
      tenantId,
      caseId,
      eventType,
      actorKind,
      actorUserId,
      payload,
    };

    const commitmentHash = this.generateCommitmentHash(normalized);

    const sign = createSign("SHA256");
    sign.update(commitmentHash);
    const signature = sign.sign(this.privateKey, "hex");

    return prisma.ledgerCommit.create({
      data: {
        tenantId,
        caseId,
        eventType: eventType as any,
        ts: BigInt(
          typeof normalized.ts === "bigint" ? normalized.ts : normalized.ts,
        ),
        actorKind: actorKind as any,
        actorUserId,
        payload: payload as any,
        commitmentHash,
        signature,
        supersedesCommitId: normalized.supersedesCommitId ?? null,
      },
    });
  }

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

      const expected = this.generateHash(reconstructed);
      if (expected !== r.commitmentHash) return false;

      if (!r.signature) return false;

      const verify = createVerify("SHA256");
      verify.update(r.commitmentHash);

      if (!verify.verify(this.publicKey, r.signature, "hex")) return false;
    }

    return true;
  }

  private generateCommitmentHash(input: LedgerCommitInput): string {
    const payload = {
      tenantId: input.tenantId ?? "unknown",
      caseId: input.caseId ?? null,
      postWinId: input.postWinId ?? undefined,
      eventType: input.eventType ?? input.action ?? "LEGACY_EVENT",
      ts:
        typeof input.ts === "bigint" ? Number(input.ts) : (input.ts as number),
      actorKind: input.actorKind ?? "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      supersedesCommitId: input.supersedesCommitId ?? null,
      payload: input.payload ?? {
        postWinId: input.postWinId ?? null,
        action: input.action ?? null,
        actorId: input.actorId ?? null,
        previousState: input.previousState ?? null,
        newState: input.newState ?? null,
      },
    };

    return this.generateHash(payload);
  }

  private generateHash(data: unknown): string {
    return createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
