// apps/backend/src/modules/health/health.controller.ts
// Ledger health endpoint with graceful degradation.

import { Router, type Request, type Response } from "express";
import { LedgerService } from "../intake/ledger/ledger.service";

const router: Router = Router();
const ledgerService = new LedgerService();

router.get("/health/ledger", async (_req: Request, res: Response) => {
  try {
    const healthData = await ledgerService.getStatus();
    const statusCode = healthData.status === "HEALTHY" ? 200 : 503;
    res.status(statusCode).json(healthData);
  } catch {
    res.status(503).json({
      status: "CORRUPTED",
      error: "Ledger health check failed unexpectedly.",
    });
  }
});

export default router;

/*
Design reasoning
----------------
Health endpoints must never throw unhandled exceptions.
They must degrade predictably under failure.

Structure
---------
- try/catch wrapper
- status mapping
- fallback corrupted response

Implementation guidance
-----------------------
Mount under app.ts using:
app.use("/api", healthRoutes);

Scalability insight
-------------------
Prevents cascading failures during integrity checks.
Ensures observability remains available even during corruption events.

Would I ship this?
Yes.
*/
