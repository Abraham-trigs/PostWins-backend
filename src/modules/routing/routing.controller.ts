// filepath: apps/backend/src/modules/routing/routing.controller.ts
// Purpose: Case routing controller responsible for manual routing operations
// and routing inspection with safe query normalization.

import { Request, Response } from "express";
import { prismaUnsafe as prisma } from "@/lib/prisma";
import { log } from "@/lib/observability/logger";
import { z } from "zod";

////////////////////////////////////////////////////////////////
// Validation
////////////////////////////////////////////////////////////////

const ManualRouteSchema = z.object({
  tenantId: z.string().uuid(),
  caseId: z.string().uuid(),
  routeTo: z.string().min(1),
});

////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////

function normalizeQueryParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

////////////////////////////////////////////////////////////////
// Manual routing handler
////////////////////////////////////////////////////////////////

export async function handleManualRoute(req: Request, res: Response) {
  try {
    const parsed = ManualRouteSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.flatten().fieldErrors,
      });
    }

    const { tenantId, caseId, routeTo } = parsed.data;

    const caseRow = await prisma.case.findFirst({
      where: {
        id: caseId,
        tenantId,
      },
      select: {
        id: true,
        type: true,
      },
    });

    if (!caseRow) {
      return res.status(404).json({
        error: "CASE_NOT_FOUND",
      });
    }

    log("INFO", "Manual routing requested", {
      tenantId,
      caseId,
      routeTo,
    });

    return res.json({
      success: true,
      data: {
        caseId,
        routedTo: routeTo,
      },
    });
  } catch (error) {
    log("ERROR", "Manual routing failed", { error });

    return res.status(500).json({
      error: "ROUTING_FAILED",
    });
  }
}

////////////////////////////////////////////////////////////////
// Routing inspection handler (used for debug / UI inspection)
////////////////////////////////////////////////////////////////

export async function getRoutingDecision(req: Request, res: Response) {
  try {
    const tenantId = (req as any).tenantId as string;

    const caseId = normalizeQueryParam(
      req.query.caseId as string | string[] | undefined,
    );

    if (!caseId) {
      return res.status(400).json({
        error: "caseId query parameter required",
      });
    }

    const caseRow = await prisma.case.findFirst({
      where: {
        id: caseId,
        tenantId,
      },
      select: {
        id: true,
        type: true,
      },
    });

    if (!caseRow) {
      return res.status(404).json({
        error: "CASE_NOT_FOUND",
      });
    }

    return res.json({
      data: {
        caseId: caseRow.id,
        caseType: caseRow.type,
      },
    });
  } catch (error) {
    log("ERROR", "Routing inspection failed", { error });

    return res.status(500).json({
      error: "ROUTING_LOOKUP_FAILED",
    });
  }
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
Controllers must normalize Express query params before passing them
to Prisma. Express may return string[] when duplicate query params
exist, which violates Prisma's UUID filter typing.

Manual routing is separated from routing inspection so that
governance services can call routing logic independently
without coupling to request parsing.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- handleManualRoute
- getRoutingDecision
*/

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
cases.routes.ts expects:

import { handleManualRoute } from "../routing/routing.controller";

router.post("/manual-route", handleManualRoute);
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
As routing grows more complex, routing decisions should be moved
into routing.service.ts with policy engines and explainability
hooks so routing decisions can be audited and simulated.
*/
