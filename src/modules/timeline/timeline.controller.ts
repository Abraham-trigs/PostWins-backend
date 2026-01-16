import type { Request, Response } from "express";
import { TimelineService } from "./timeline.service";

const svc = new TimelineService();

/**
 * GET /api/timeline/:projectId
 */
export async function getTimeline(req: Request, res: Response) {
  const projectId = String(req.params.projectId || "").trim();

  if (!projectId) {
    return res.status(400).json({ ok: false, error: "Missing projectId" });
  }

  const data = await svc.build(projectId);
  return res.status(200).json(data);
}
