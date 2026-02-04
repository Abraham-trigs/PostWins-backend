import type { Request, Response } from "express";
import { TimelineService } from "./timeline.service";

const svc = new TimelineService();

// Strict UUID v4–v5 validator
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/timeline/:projectId
 */
export async function getTimeline(req: Request, res: Response) {
  const projectId = String(req.params.projectId || "").trim();

  if (!projectId) {
    return res.status(400).json({ ok: false, error: "Missing projectId" });
  }

  // ✅ Prevent Prisma UUID crash
  if (!UUID_RE.test(projectId)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid projectId (expected UUID)",
    });
  }

  const data = await svc.build(projectId);
  return res.status(200).json(data);
}
