// apps/backend/src/modules/intake/controllers/intake.location.controller.ts
// Purpose: Resolve GhanaPost address code into geographic coordinates

import { Request, Response } from "express";
import { IntakeService } from "../services/intake.service";
import { IntegrityService } from "../intergrity/integrity.service";
import { TaskService } from "@/modules/routing/structuring/task.service";

const integrityService = new IntegrityService();
const intakeService = new IntakeService(integrityService, new TaskService());

export const handleResolveLocation = async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code ?? "").trim();

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "CODE_REQUIRED",
      });
    }

    const result = await intakeService.resolveGhanaPostAddress(code);

    return res.status(200).json({
      ok: true,
      lat: result.lat,
      lng: result.lng,
      bounds: result.bounds,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_ADDRESS") {
      return res.status(400).json({
        ok: false,
        error: err.message,
      });
    }

    return res.status(502).json({
      ok: false,
      error: "LOCATION_RESOLUTION_FAILED",
    });
  }
};

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Location resolution is isolated so intake controllers remain
// focused purely on case governance.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// handleResolveLocation()

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Route example:
// GET /intake/location?code=GA-123-4567

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Additional geocoders (Google, Mapbox) can be layered inside
// IntakeService without touching this controller.
