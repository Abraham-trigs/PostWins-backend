// apps/backend/src/server.ts
// Application bootstrap + governance scheduler with timed execution sequencing.
// Multi-instance safe via Postgres advisory lock (optional).

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
import { prisma } from "./lib/prisma";

// ✅ Governance Layer
import { OrchestratorService } from "./modules/orchestrator/orchestrator.service";
import { DecisionOrchestrationService } from "./modules/decision/decision-orchestration.service";
import { DecisionService } from "./modules/decision/decision.service";

////////////////////////////////////////////////////////////////
// Environment
////////////////////////////////////////////////////////////////

const PORT = Number(process.env.PORT) || 3001;
const MODE = process.env.MODE || "production";

const ENABLE_SCHEDULER = process.env.ENABLE_LIFECYCLE_SCHEDULER === "true";
const ENABLE_SCHEDULER_LOCK = process.env.ENABLE_LIFECYCLE_LOCK !== "false";

const SCHEDULER_INTERVAL_MS =
  Number(process.env.LIFECYCLE_INTERVAL_MS) || 24 * 60 * 60 * 1000;

const SCHEDULER_INITIAL_DELAY_MS =
  Number(process.env.LIFECYCLE_INITIAL_DELAY_MS) || 0;

const SCHEDULER_RUN_IMMEDIATELY =
  process.env.LIFECYCLE_RUN_IMMEDIATELY === "true";

const SCHEDULER_PER_TENANT_DELAY_MS =
  Number(process.env.LIFECYCLE_PER_TENANT_DELAY_MS) || 100;

let scheduler: LifecycleReconciliationScheduler | null = null;

////////////////////////////////////////////////////////////////
// MOCK MODE
////////////////////////////////////////////////////////////////

if (MODE === "MOCK") {
  const ledger = new LedgerService();
  const integrity = new IntegrityService();

  // 🔁 Governance wiring
  const orchestrator = new OrchestratorService();
  const decisionOrchestration = new DecisionOrchestrationService(orchestrator);
  const decisionService = new DecisionService(decisionOrchestration);

  // 🧠 Domain services
  const tasks = new TaskService();
  const journey = new JourneyService();

  const verifier = new VerificationService(ledger, decisionService);
  const router = new PostWinRoutingService(tasks, journey);
  const intake = new IntakeService(integrity, tasks);

  const mockEngine = new PostaMockEngine(intake, verifier);

  mockEngine.runSimulation().catch((err) => {
    console.error("Mock Simulation Failed:", err);
  });
}

////////////////////////////////////////////////////////////////
// Advisory Lock (Multi-Instance Safety)
////////////////////////////////////////////////////////////////

async function acquireSchedulerLock(): Promise<boolean> {
  if (!ENABLE_SCHEDULER_LOCK) return true;

  try {
    const [{ pg_try_advisory_lock }] = await prisma.$queryRaw<
      { pg_try_advisory_lock: boolean }[]
    >`SELECT pg_try_advisory_lock(937421)`;

    return pg_try_advisory_lock;
  } catch {
    return false;
  }
}

////////////////////////////////////////////////////////////////
// SERVER START
////////////////////////////////////////////////////////////////

const server = app.listen(PORT, async () => {
  console.log(
    `Posta Backend running on http://localhost:${PORT} in ${MODE} mode`,
  );

  if (!ENABLE_SCHEDULER || MODE === "MOCK") return;

  const lockAcquired = await acquireSchedulerLock();

  if (!lockAcquired) {
    console.warn(
      "Lifecycle Scheduler lock not acquired. Another instance is leader.",
    );
    return;
  }

  scheduler = new LifecycleReconciliationScheduler({
    intervalMs: SCHEDULER_INTERVAL_MS,
    initialDelayMs: SCHEDULER_INITIAL_DELAY_MS,
    runImmediately: SCHEDULER_RUN_IMMEDIATELY,
    perTenantDelayMs: SCHEDULER_PER_TENANT_DELAY_MS,
  });

  scheduler.start();

  console.log("Lifecycle Reconciliation Scheduler enabled", {
    intervalMs: SCHEDULER_INTERVAL_MS,
    initialDelayMs: SCHEDULER_INITIAL_DELAY_MS,
    runImmediately: SCHEDULER_RUN_IMMEDIATELY,
    perTenantDelayMs: SCHEDULER_PER_TENANT_DELAY_MS,
    lockEnabled: ENABLE_SCHEDULER_LOCK,
  });
});

////////////////////////////////////////////////////////////////
// GRACEFUL SHUTDOWN
////////////////////////////////////////////////////////////////

async function shutdown() {
  console.log("Shutting down...");

  if (scheduler) {
    scheduler.stop();
  }

  try {
    if (ENABLE_SCHEDULER_LOCK) {
      await prisma.$queryRaw`SELECT pg_advisory_unlock(937421)`;
    }
  } catch {
    // ignore
  }

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
