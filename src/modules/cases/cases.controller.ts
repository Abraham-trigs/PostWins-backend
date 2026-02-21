// apps/backend/src/modules/cases/cases.controller.ts
// Purpose: List cases with authoritative lifecycle + latest message signal.

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

      // ✅ AUTHORITATIVE: Constitutional Truth
      lifecycle: true,

      // ✅ ADVISORY: Metadata for UI Display
      currentTask: true,
      type: true,
      scope: true,
      sdgGoal: true,
      summary: true,
      createdAt: true,
      updatedAt: true,

      // Latest routing decision snapshot
      routingDecisions: {
        orderBy: { decidedAt: "desc" },
        take: 1,
        select: {
          routingOutcome: true,
        },
      },

      // 🔥 NEW: Fetch only the latest message for the chat preview
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

  const cases = rows.map((row) => {
    const decisionOutcome =
      row.routingDecisions[0]?.routingOutcome ?? "UNASSIGNED";

    // Extract the latest signal if it exists
    const lastMessage = row.messages[0] ?? null;

    return {
      id: row.id,

      // Authoritative State
      lifecycle: row.lifecycle,

      // UI Labels
      currentTask: row.currentTask,
      routingOutcome: decisionOutcome,

      // Case Metadata
      type: row.type,
      scope: row.scope,
      sdgGoal: row.sdgGoal,
      summary: row.summary,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,

      // 🔥 Last Message Projection
      // This maps directly to the frontend's c.lastMessage check
      lastMessage,
    };
  });

  return res.status(200).json({ ok: true, cases });
}
