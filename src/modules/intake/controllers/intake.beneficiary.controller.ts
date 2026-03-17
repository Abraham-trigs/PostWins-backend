// apps/backend/src/modules/intake/controllers/intake.beneficiary.controller.ts
// Purpose: Fetch existing beneficiaries for intake selection

import { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { requireTenantId } from "../helpers/intake.helpers";

/**
 * GET /intake/beneficiaries
 * Query params:
 *   - search?: string   // partial name or phone
 *   - limit?: number    // max results
 *   - skip?: number     // offset for pagination
 */
export const handleFetchBeneficiaries = async (req: Request, res: Response) => {
  try {
    const tenantId = requireTenantId(req);

    const search = (req.query.search as string | undefined)?.trim() ?? "";
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = parseInt(req.query.skip as string) || 0;

    const beneficiaries = await prisma.beneficiary.findMany({
      where: {
        tenantId,
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { pii: { some: { phone: { contains: search } } } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        pii: { select: { phone: true } },
        profile: { select: { consentToDataStorage: true } },
      },
      orderBy: { displayName: "asc" },
      skip,
      take: limit,
    });

    const totalCount = await prisma.beneficiary.count({
      where: {
        tenantId,
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { pii: { some: { phone: { contains: search } } } },
        ],
      },
    });

    return res.status(200).json({
      ok: true,
      beneficiaries,
      meta: { totalCount, limit, skip },
    });
  } catch (error: any) {
    console.error("❌ FETCH_BENEFICIARIES_ERROR:", error);
    return res.status(500).json({
      ok: false,
      error: error.message ?? "FETCH_BENEFICIARIES_FAILED",
    });
  }
};
