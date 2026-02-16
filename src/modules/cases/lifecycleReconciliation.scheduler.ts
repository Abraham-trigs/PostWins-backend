// apps/backend/src/modules/cases/lifecycleReconciliation.scheduler.ts
// Sovereign lifecycle reconciliation scheduler.
// Drift detection only. No lifecycle mutation here.
// Now protected by Postgres advisory lock for multi-instance safety.

import { prisma } from "@/lib/prisma";
import { TenantLifecycleReconciliationJob } from "./tenantLifecycleReconciliation.job";

const ADVISORY_LOCK_KEY = 987654321; // Stable bigint constant for global scheduler lock

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
  private inFlight = false; // prevents overlap (single process)

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

  ////////////////////////////////////////////////////////////////
  // Safe runner with advisory lock (cluster-safe)
  ////////////////////////////////////////////////////////////////

  private async safeRun() {
    if (!this.running || this.inFlight) return;

    this.inFlight = true;

    try {
      // Acquire global advisory lock
      const [{ pg_try_advisory_lock }] = await prisma.$queryRaw<
        { pg_try_advisory_lock: boolean }[]
      >`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY})`;

      if (!pg_try_advisory_lock) {
        console.log(
          "[LifecycleReconciliationScheduler] Another instance holds lock. Skipping.",
        );
        return;
      }

      try {
        await this.run();
      } finally {
        await prisma.$queryRaw`
          SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})
        `;
      }
    } catch (err) {
      console.error("[LifecycleReconciliationScheduler] Run failure:", err);
    } finally {
      this.inFlight = false;
    }
  }

  ////////////////////////////////////////////////////////////////
  // Drift detection per tenant
  ////////////////////////////////////////////////////////////////

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
Single-process guard (inFlight) prevents overlap inside one instance.
Postgres advisory lock prevents overlap across multiple instances.
Drift detection remains read-focused and constitutionally safe.

Structure
---------
- start()
- stop()
- safeRun() → advisory lock boundary
- run() → per-tenant drift detection

Implementation guidance
-----------------------
Ensure Postgres is primary DB (advisory locks are Postgres-specific).
Lock key must remain stable across deployments.
Never use dynamic keys for global schedulers.

Scalability insight
-------------------
This now supports horizontal scaling safely.
Only one instance executes reconciliation at a time.
Advisory locks provide leader-election without external infra.
System can scale without lifecycle race conditions.
*/
