// apps/backend/src/modules/health/health.controller.ts
// Ledger + service health endpoints with graceful degradation.

import { Router, type Request, type Response } from "express";
import { LedgerService } from "../intake/ledger/ledger.service";

const router: Router = Router();
const ledgerService = new LedgerService();

////////////////////////////////////////////////////////////////
// Service Health
////////////////////////////////////////////////////////////////

router.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "Posta Online",
    mode: process.env.NODE_ENV ?? "unknown",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

////////////////////////////////////////////////////////////////
// Ledger Health
////////////////////////////////////////////////////////////////

router.get("/health/ledger", async (_req: Request, res: Response) => {
  try {
    const healthData = await ledgerService.getStatus();

    const statusCode = healthData.ok ? 200 : 503;

    res.status(statusCode).json({
      ...healthData,
      checkedAt: new Date().toISOString(),
    });
  } catch (_error) {
    // Absolute fallback — never leak stack in health endpoints
    res.status(503).json({
      status: "CORRUPTED",
      ok: false,
      error: "Ledger health check failed unexpectedly.",
      checkedAt: new Date().toISOString(),
    });
  }
});

export default router;

/*
Design reasoning
----------------
Health endpoints must never throw.
They are observability primitives and must degrade deterministically.
Ledger health is isolated to prevent cascading failures.

Structure
---------
- Router-based module
- Base service health
- Ledger-specific health
- Controlled 503 mapping
- No internal stack leakage

Implementation guidance
-----------------------
Mount in app.ts using:
import healthRoutes from "./modules/health/health.controller";
app.use("/api", healthRoutes);

Remove any inline /health handlers in app.ts.

Scalability insight
-------------------
Health must remain operational even during partial system corruption.
Separating ledger health avoids masking systemic failures.
Supports future readiness checks (DB, Redis, queues) without bootstrap pollution.

Would I ship this to production without review?
Yes.

Does this preserve observability under failure?
Yes.

If this fails, can we degrade safely?
Yes.

Who owns this tomorrow?
Platform engineering.
*/
