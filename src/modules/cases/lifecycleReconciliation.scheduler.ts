// apps/backend/src/modules/cases/lifecycleReconciliation.scheduler.ts
// Sovereign lifecycle reconciliation scheduler.
// Drift detection only. No lifecycle mutation here.

import { prisma } from "@/lib/prisma";
import { TenantLifecycleReconciliationJob } from "./tenantLifecycleReconciliation.job";

export interface SchedulerOptions {
  intervalMs?: number;
  initialDelayMs?: number;
  runImmediately?: boolean;
  perTenantDelayMs?: number;
  enabled?: boolean; // environment gating
}

export class LifecycleReconciliationScheduler {
  private intervalMs: number;
  private initialDelayMs: number;
  private runImmediately: boolean;
  private perTenantDelayMs: number;
  private enabled: boolean;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = false; // prevents overlap

  private job = new TenantLifecycleReconciliationJob();

  constructor(options?: SchedulerOptions) {
    this.intervalMs = options?.intervalMs ?? 24 * 60 * 60 * 1000;
    this.initialDelayMs = options?.initialDelayMs ?? 0;
    this.runImmediately = options?.runImmediately ?? false;
    this.perTenantDelayMs = options?.perTenantDelayMs ?? 100;
    this.enabled = options?.enabled ?? true;
  }

  start() {
    if (!this.enabled) {
      console.log("[LifecycleReconciliationScheduler] Disabled");
      return;
    }

    if (this.running) return;

    this.running = true;

    const bootstrap = async () => {
      if (!this.running) return;

      if (this.runImmediately) {
        await this.safeRun();
      }

      this.timer = setInterval(() => {
        this.safeRun();
      }, this.intervalMs);
    };

    if (this.initialDelayMs > 0) {
      setTimeout(bootstrap, this.initialDelayMs);
    } else {
      bootstrap();
    }

    console.log(
      `[LifecycleReconciliationScheduler] Started | interval=${this.intervalMs}ms`,
    );
  }

  stop() {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log("[LifecycleReconciliationScheduler] Stopped");
  }

  private async safeRun() {
    if (!this.running || this.inFlight) return;

    this.inFlight = true;

    try {
      await this.run();
    } catch (err) {
      console.error("[LifecycleReconciliationScheduler] Run failure:", err);
    } finally {
      this.inFlight = false;
    }
  }

  private async run() {
    const tenants = await prisma.tenant.findMany({
      select: { id: true },
    });

    for (const tenant of tenants) {
      if (!this.running) return;

      try {
        const summary = await this.job.run(tenant.id);

        if (summary.driftedCases > 0) {
          console.warn("[LifecycleReconciliationScheduler] Drift detected", {
            tenantId: tenant.id,
            driftedCases: summary.driftedCases,
            repairedCases: summary.repairedCases,
          });
        }
      } catch (err) {
        console.error("[LifecycleReconciliationScheduler] Tenant failure", {
          tenantId: tenant.id,
          error: err,
        });
      }

      if (this.perTenantDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.perTenantDelayMs));
      }
    }
  }
}

/*
Design reasoning
----------------
Drift detection protects constitutional integrity.
Scheduler enforces:
- Non-overlapping runs
- Optional environment gating
- Per-tenant throttling
- Safe shutdown

Structure
---------
- start()
- stop()
- safeRun() (single-flight guard)
- run()

Implementation guidance
-----------------------
In production multi-instance deployments:
- Gate with process.env.ENABLE_LIFECYCLE_RECONCILIATION
- Or integrate DB-backed leader election

Scalability insight
-------------------
Single-flight prevents DB pressure spikes.
Per-tenant throttling prevents starvation.
Design supports horizontal scaling with external coordination.
*/
