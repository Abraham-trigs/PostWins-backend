// src/modules/cases/case-ref.resolver.ts
// Hardened authoritative resolver with global Tag model + supersession safety.

import { prisma } from "../../lib/prisma";
import { CaseRef } from "./case-ref";
import { ResolverError, CaseNotFoundError } from "./case.errors";

export class CaseRefResolver {
  async resolve(ref: CaseRef, tenantId: string): Promise<{ caseId: string }> {
    switch (ref.kind) {
      ////////////////////////////////////////////////////////////////
      // CASE — direct authoritative lookup
      ////////////////////////////////////////////////////////////////
      case "CASE": {
        const exists = await prisma.case.findUnique({
          where: { id: ref.id },
          select: { id: true, tenantId: true },
        });

        if (!exists || exists.tenantId !== tenantId) {
          throw new CaseNotFoundError(ref.id);
        }

        return { caseId: exists.id };
      }

      ////////////////////////////////////////////////////////////////
      // DECISION — authoritative only (not superseded)
      ////////////////////////////////////////////////////////////////
      case "DECISION": {
        const decision = await prisma.decision.findFirst({
          where: {
            id: ref.id,
            tenantId,
            supersededAt: null,
          },
          select: { caseId: true },
        });

        if (!decision) {
          throw new ResolverError("Authoritative decision not found");
        }

        return { caseId: decision.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // POLICY — authoritative decision by policyKey
      ////////////////////////////////////////////////////////////////
      case "POLICY": {
        const decision = await prisma.decision.findFirst({
          where: {
            tenantId,
            supersededAt: null,
            intentContext: {
              path: ["policyKey"],
              equals: ref.policyKey,
            },
          },
          orderBy: { decidedAt: "desc" },
          select: { caseId: true },
        });

        if (!decision) {
          throw new ResolverError("Policy reference not found");
        }

        return { caseId: decision.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // LEDGER — only active (not superseded) commit
      ////////////////////////////////////////////////////////////////
      case "LEDGER": {
        const commit = await prisma.ledgerCommit.findFirst({
          where: {
            id: ref.id,
            tenantId,
            supersededBy: null,
          },
          select: { caseId: true },
        });

        if (!commit) {
          throw new ResolverError("Active ledger reference not found");
        }

        // Enforce invariant (no cast)
        if (!commit.caseId) {
          throw new Error("Invariant violation: LedgerCommit missing caseId");
        }

        return { caseId: commit.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // TAG — global Tag + CaseTag join
      ////////////////////////////////////////////////////////////////
      case "TAG": {
        const caseTag = await prisma.caseTag.findFirst({
          where: {
            tag: {
              key: ref.value,
            },
            case: {
              tenantId,
            },
          },
          orderBy: { createdAt: "desc" },
          select: { caseId: true },
        });

        if (!caseTag) {
          throw new ResolverError("Tag reference not found");
        }

        return { caseId: caseTag.caseId };
      }

      ////////////////////////////////////////////////////////////////
      // Unsupported
      ////////////////////////////////////////////////////////////////
      default:
        throw new ResolverError("Unsupported CaseRef");
    }
  }
}

export const caseRefResolver = new CaseRefResolver();

////////////////////////////////////////////////////////////////
/// Design reasoning
////////////////////////////////////////////////////////////////
// This resolver enforces authoritative boundaries across CASE,
// DECISION, LEDGER, and TAG references. Supersession safety
// prevents stale governance references. Tenant boundary is
// strictly enforced at resolution time.

////////////////////////////////////////////////////////////////
/// Structure
////////////////////////////////////////////////////////////////
// - CASE → findUnique + tenant boundary
// - DECISION → non-superseded only
// - POLICY → resolved via decision intentContext
// - LEDGER → non-superseded + invariant enforcement
// - TAG → Tag + CaseTag join enforcing tenant via Case

////////////////////////////////////////////////////////////////
/// Implementation guidance
////////////////////////////////////////////////////////////////
// Use this resolver before any mutation or explain operation.
// Never trust raw IDs directly in controllers.
// Always resolve to authoritative caseId first.

////////////////////////////////////////////////////////////////
/// Scalability insight
////////////////////////////////////////////////////////////////
// This structure supports future expansion (APPEAL, EXECUTION,
// VERIFICATION refs) without weakening invariants. Supersession
// logic prevents governance drift under replay or concurrency.
////////////////////////////////////////////////////////////////
