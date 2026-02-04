// apps/backend/src/modules/health/health.controller.ts
import { Router, type Request, type Response } from "express";
import { LedgerService } from "../intake/ledger.service";

const router: Router = Router();
const ledgerService = new LedgerService();

// NOTE: This router will be mounted by app.ts (e.g. app.use("/api", healthRoutes))
router.get("/health/ledger", async (_req: Request, res: Response) => {
  const healthData = await ledgerService.getStatus();
  const statusCode = healthData.status === "HEALTHY" ? 200 : 503;
  res.status(statusCode).json(healthData);
});

export default router;
