// apps/backend/src/modules/intake/ledger/ledger.service.ts
// Purpose: Sovereign ledger authority responsible for immutable commits.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
This service is the constitutional mutation boundary of the system.
All state transitions flow through this service to guarantee:

- Immutable append-only ledger
- Deterministic ordering
- Cryptographic integrity
- Idempotent commit safety
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- LedgerService

Public methods
- appendEntry()
- getAuditTrail()
- listByProject()
- getStatus()
*/

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import { createSign } from "crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getRequestId } from "@/lib/observability/request-context";
import { validateAuthoritySupersession } from "./authorityHierarchy.policy";

import { LedgerCommitSchema } from "./ledger.schema";
import {
  LedgerValidationError,
  LedgerSupersessionError,
} from "./ledger.errors";
import { generateHash } from "./ledger.crypto";
import { loadLedgerKeys } from "./ledger.keys";

export class LedgerService {
  private privateKey: string;
  public publicKey: string;

  constructor() {
    const keys = loadLedgerKeys();
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
  }

  ////////////////////////////////////////////////////////////////
  // Public mutation API
  ////////////////////////////////////////////////////////////////

  public async appendEntry(input: unknown, tx?: Prisma.TransactionClient) {
    return this.commit(input, tx);
  }

  ////////////////////////////////////////////////////////////////
  // Read APIs
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
  // Commit pipeline
  ////////////////////////////////////////////////////////////////

  private async commit(input: unknown, tx?: Prisma.TransactionClient) {
    const parsed = LedgerCommitSchema.safeParse(input);

    if (!parsed.success) {
      throw new LedgerValidationError(parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;
    const db = tx ?? prisma;
    const requestId = getRequestId();

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

    const [{ nextval }] = await db.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('ledger_global_seq')
    `;

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

    const commitmentHash = generateHash(authoritative);

    const signer = createSign("SHA256");
    signer.update(commitmentHash);
    const signature = signer.sign(this.privateKey, "hex");

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
      throw e;
    }
  }
}

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Example:

await ledgerService.appendEntry({
  tenantId,
  caseId,
  eventType: LedgerEventType.CASE_CREATED,
  actorKind: ActorKind.HUMAN,
  actorUserId: user.id,
  authorityProof: "case:create",
});
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
Large deployments should build event projections from this ledger
for analytics and timelines rather than querying the ledger table
directly.
*/
