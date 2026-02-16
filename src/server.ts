// apps/backend/src/server.ts
// Application bootstrap + governance scheduler with timed execution sequencing.

import app from "./app";
import { PostaMockEngine } from "./modules/routing/structuring/mock-engine";
import { IntakeService } from "./modules/intake/intake.service";
import { PostWinRoutingService } from "./modules/routing/structuring/postwin-routing.service";
import { VerificationService } from "./modules/verification/verification.service";
import { IntegrityService } from "./modules/intake/intergrity/integrity.service";
import { LedgerService } from "./modules/intake/ledger/ledger.service";
import { TaskService } from "./modules/routing/structuring/task.service";
import { JourneyService } from "./modules/routing/journey/journey.service";
import { LifecycleReconciliationScheduler } from "./modules/cases/lifecycleReconciliation.scheduler";

const PORT = Number(process.env.PORT) || 3001;
const MODE = process.env.MODE || "production";

const ENABLE_SCHEDULER = process.env.ENABLE_LIFECYCLE_SCHEDULER === "true";

const SCHEDULER_INTERVAL_MS =
  Number(process.env.LIFECYCLE_INTERVAL_MS) || 24 * 60 * 60 * 1000; // default 24h

const SCHEDULER_INITIAL_DELAY_MS =
  Number(process.env.LIFECYCLE_INITIAL_DELAY_MS) || 0;

const SCHEDULER_RUN_IMMEDIATELY =
  process.env.LIFECYCLE_RUN_IMMEDIATELY === "true";

const SCHEDULER_PER_TENANT_DELAY_MS =
  Number(process.env.LIFECYCLE_PER_TENANT_DELAY_MS) || 100;

let scheduler: LifecycleReconciliationScheduler | null = null;

/* -------------------------------------------------------------------------- */
/* MOCK MODE                                                                  */
/* -------------------------------------------------------------------------- */

if (MODE === "MOCK") {
  const ledger = new LedgerService();
  const integrity = new IntegrityService();

  const tasks = new TaskService();
  const journey = new JourneyService();
  const verifier = new VerificationService(ledger);
  const router = new PostWinRoutingService(tasks, journey, ledger);
  const intake = new IntakeService(integrity, tasks);

  const mockEngine = new PostaMockEngine(intake, router, verifier);

  mockEngine.runSimulation().catch((err) => {
    console.error("❌ Mock Simulation Failed:", err);
  });
}

/* -------------------------------------------------------------------------- */
/* SERVER START                                                               */
/* -------------------------------------------------------------------------- */

const server = app.listen(PORT, () => {
  console.log(
    `🚀 Posta Backend running on http://localhost:${PORT} in ${MODE} mode`,
  );

  if (ENABLE_SCHEDULER && MODE !== "MOCK") {
    scheduler = new LifecycleReconciliationScheduler({
      intervalMs: SCHEDULER_INTERVAL_MS,
      initialDelayMs: SCHEDULER_INITIAL_DELAY_MS,
      runImmediately: SCHEDULER_RUN_IMMEDIATELY,
      perTenantDelayMs: SCHEDULER_PER_TENANT_DELAY_MS,
    });

    scheduler.start();

    console.log("🛡️ Lifecycle Reconciliation Scheduler enabled", {
      intervalMs: SCHEDULER_INTERVAL_MS,
      initialDelayMs: SCHEDULER_INITIAL_DELAY_MS,
      runImmediately: SCHEDULER_RUN_IMMEDIATELY,
      perTenantDelayMs: SCHEDULER_PER_TENANT_DELAY_MS,
    });
  }
});

/* -------------------------------------------------------------------------- */
/* GRACEFUL SHUTDOWN                                                          */
/* -------------------------------------------------------------------------- */

function shutdown() {
  console.log("🛑 Shutting down...");

  if (scheduler) {
    scheduler.stop();
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
