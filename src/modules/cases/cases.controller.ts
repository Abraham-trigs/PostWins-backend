// NOTE:
// Lifecycle is authoritative.
// If this change represents a decision, use transitionCaseLifecycleWithLedger.

import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { validate as isUuid } from "uuid";

export async function listCases(req: Request, res: Response) {
  const tenantId = String(req.header("X-Tenant-Id") || "").trim();

  if (!tenantId) {
    return res.status(400).json({ ok: false, error: "Missing X-Tenant-Id" });
  }

  if (!isUuid(tenantId)) {
    return res.status(400).json({
      ok: false,
      error: "X-Tenant-Id must be a valid UUID",
    });
  }

  const rows = await prisma.case.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,

      // ✅ AUTHORITATIVE
      lifecycle: true,

      // ⚠️ ADVISORY
      // status: true,

      // ✅ CANONICAL TASK IDENTIFIER (LABEL ONLY)
      currentTask: true,

      type: true,
      scope: true,
      sdgGoal: true,
      summary: true,
      createdAt: true,
      updatedAt: true,

      // decision metadata (snapshot only)
      routingDecisions: {
        orderBy: { decidedAt: "desc" },
        take: 1,
        select: {
          routingOutcome: true,
        },
      },
    },
  });

  const cases = rows.map((row) => {
    const decisionOutcome =
      row.routingDecisions[0]?.routingOutcome ?? "UNASSIGNED";

    return {
      id: row.id,

      // authoritative
      lifecycle: row.lifecycle,

      // advisory
      // status: row.status,

      // ✅ task label (no semantics attached)
      currentTask: row.currentTask,

      // decision metadata
      routingOutcome: decisionOutcome,

      type: row.type,
      scope: row.scope,
      sdgGoal: row.sdgGoal,
      summary: row.summary,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  return res.status(200).json({ ok: true, cases });
}
