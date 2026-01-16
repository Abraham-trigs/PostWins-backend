"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTimeline = getTimeline;
const timeline_service_1 = require("./timeline.service");
const svc = new timeline_service_1.TimelineService();
/**
 * GET /api/timeline/:projectId
 */
async function getTimeline(req, res) {
    const projectId = String(req.params.projectId || "").trim();
    if (!projectId) {
        return res.status(400).json({ ok: false, error: "Missing projectId" });
    }
    const data = await svc.build(projectId);
    return res.status(200).json(data);
}
