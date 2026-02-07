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
      status: true,
      routingStatus: true,
      type: true,
      scope: true,
      sdgGoal: true,
      summary: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return res.status(200).json({ ok: true, cases: rows });
}
