import { Router, type Router as ExpressRouter } from "express";
import { getTimeline } from "./timeline.controller";

const router: ExpressRouter = Router();
router.get("/:projectId", getTimeline);

export default router;
