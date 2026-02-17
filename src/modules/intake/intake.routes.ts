import { Router, type Router as ExpressRouter } from "express";
import {
  handleIntakeBootstrap,
  handleIntakeDelivery,
  handleResolveLocation,
} from "./intake.controller";
import { idempotencyGuard } from "../../middleware/idempotency.middleware";

const router: ExpressRouter = Router();

router.post("/bootstrap", idempotencyGuard, handleIntakeBootstrap);

router.post("/delivery", idempotencyGuard, handleIntakeDelivery);

router.get("/resolve-location", handleResolveLocation);

export default router;
