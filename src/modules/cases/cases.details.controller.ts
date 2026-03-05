// apps/backend/src/modules/cases/cases.details.controller.ts
// Purpose: Authoritative Case Details endpoint aligned with actual Prisma schema relations.

import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { validate as isUuid } from "uuid";

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

interface CaseDetailsResponse {
  ok: true;
  case: {
    id: string;
    referenceCode: string;
    lifecycle: string;
    status: string;
    type: string;
    scope: string;
    sdgGoal: string | null;
    summary: string | null;
    createdAt: string;
    updatedAt: string;

    currentTask: {
      id: string | null;
      label: string | null;
    };

    beneficiary: null | {
      id: string;
      profile: unknown | null;
      pii: null | {
        phone: string | null;
        address: string | null;
        dateOfBirth: string | null;
      };
    };

    assignedExecutionBody: null | {
      id: string;
    };

    latestRoutingOutcome: string;

    lastMessage: null | {
      body: string | null;
      type: string;
      createdAt: string;
    };
  };
}

////////////////////////////////////////////////////////////////
// Controller
////////////////////////////////////////////////////////////////

export async function getCaseDetails(
  req: Request,
  res: Response<CaseDetailsResponse | { ok: false; error: string }>,
) {
  const auth = (req as any).user;

  if (!auth?.tenantId || !auth?.userId) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const tenantId: string = auth.tenantId;
  const requesterRole: string | undefined = auth.role;

  const caseId = String(req.params.id ?? "");

  if (!isUuid(caseId)) {
    return res.status(400).json({ ok: false, error: "Invalid case id" });
  }

  ////////////////////////////////////////////////////////////
  // Prisma Query (schema-aligned)
  ////////////////////////////////////////////////////////////

  const row = await prisma.case.findFirst({
    where: { id: caseId, tenantId },
    select: {
      id: true,
      referenceCode: true,
      lifecycle: true,
      status: true,
      type: true,
      scope: true,
      sdgGoal: true,
      summary: true,
      createdAt: true,
      updatedAt: true,

      currentTaskDefinitionId: true,
      currentTaskDefinition: {
        select: { id: true, label: true },
      },

      beneficiary: {
        select: {
          id: true,
          profile: true,
          pii: {
            select: {
              phone: true,
              address: true,
              dateOfBirth: true,
            },
          },
        },
      },

      assignment: {
        select: {
          executionBodyId: true,
        },
      },

      routingDecisions: {
        orderBy: { decidedAt: "desc" },
        take: 1,
        select: {
          routingOutcome: true,
        },
      },

      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          body: true,
          type: true,
          createdAt: true,
        },
      },
    },
  });

  if (!row) {
    return res.status(404).json({ ok: false, error: "Case not found" });
  }

  ////////////////////////////////////////////////////////////
  // PII Least Privilege
  ////////////////////////////////////////////////////////////

  const allowPII =
    requesterRole === "ADMIN" ||
    requesterRole === "STAFF" ||
    requesterRole === "NGO_PARTNER";

  ////////////////////////////////////////////////////////////
  // Response Mapping
  ////////////////////////////////////////////////////////////

  return res.status(200).json({
    ok: true,
    case: {
      id: row.id,
      referenceCode: row.referenceCode,
      lifecycle: row.lifecycle,
      status: row.status,
      type: row.type,
      scope: row.scope,
      sdgGoal: row.sdgGoal,
      summary: row.summary,

      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),

      currentTask: {
        id: row.currentTaskDefinitionId,
        label: row.currentTaskDefinition?.label ?? null,
      },

      beneficiary: row.beneficiary
        ? {
            id: row.beneficiary.id,
            profile: row.beneficiary.profile ?? null,
            pii: allowPII
              ? {
                  phone: row.beneficiary.pii?.phone ?? null,
                  address: row.beneficiary.pii?.address ?? null,
                  dateOfBirth:
                    row.beneficiary.pii?.dateOfBirth?.toISOString() ?? null,
                }
              : null,
          }
        : null,

      assignedExecutionBody: row.assignment
        ? {
            id: row.assignment.executionBodyId,
          }
        : null,

      latestRoutingOutcome:
        row.routingDecisions[0]?.routingOutcome ?? "UNASSIGNED",

      lastMessage:
        row.messages[0] !== undefined
          ? {
              body: row.messages[0].body,
              type: row.messages[0].type,
              createdAt: row.messages[0].createdAt.toISOString(),
            }
          : null,
    },
  });
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Aligns strictly with Prisma schema:
// - CaseAssignment exposes executionBodyId (not assignee).
// - Messages belong directly to Case.
// - RoutingDecision tied to Case.
// - Beneficiary → profile + pii relations preserved.
// Eliminates all invalid Prisma selections causing TS errors.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// Auth guard
// UUID validation
// Prisma projection
// PII gate
// Response DTO mapping

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// router.get("/cases/:id", requireAuth, getCaseDetails)

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Future: split beneficiary, routing, and messages into
// loader services if details payload grows.
////////////////////////////////////////////////////////////////
