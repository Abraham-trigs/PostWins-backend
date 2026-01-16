import { Router } from "express";
import { getTimeline } from "./timeline.controller";

const router = Router();
router.get("/:projectId", getTimeline);

export default router;
