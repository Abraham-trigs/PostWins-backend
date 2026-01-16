// apps/backend/src/modules/health/health.controller.ts
import { Router } from "express";
import { LedgerService } from "../intake/ledger.service";

const router = Router();
const ledgerService = new LedgerService();

router.get("/health/ledger", (req, res) => {
  const healthData = ledgerService.getStatus();
  
  // Return 200 for healthy, 503 for corruption
  const statusCode = healthData.status === "HEALTHY" ? 200 : 503;
  res.status(statusCode).json(healthData);
});

export default router;
