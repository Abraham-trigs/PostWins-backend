// apps/backend/src/modules/timeline/timeline.service.ts

/**
 * TIMELINE PROJECTION SERVICE
 *
 * PURPOSE
 * -------
 * Builds a human-readable timeline for a case (projectId) by projecting
 * immutable ledger facts into display-oriented timeline items.
 *
 * CRITICAL BOUNDARIES
 * ------------------
 * - This service NEVER writes to the ledger.
 * - This service NEVER infers workflow state.
 * - This service NEVER mutates or enriches ledger facts.
 *
 * The ledger records WHAT happened.
 * This service explains WHEN and HOW it is shown.
 *
 * If you need to change business rules, do it upstream
 * (application services that emit ledger events).
 */

import {
  FOLLOWUP_SCHEDULE_DAYS,
  FOLLOWUP_WINDOW_DAYS,
} from "../../utils/postwins.paths";
import { LedgerService } from "@/modules/intake/ledger/ledger.service";
/* -------------------------------------------------------------------------- */
/* Timeline Types (Projection-Only)                                            */
/* -------------------------------------------------------------------------- */
/**
 * These types are NOT ledger types.
 * They are read-only, UI-facing projections.
 *
 * Adding a new type here requires:
 * - explicit backend logic
 * - explicit frontend rendering
 *
 * Do NOT add evaluative states (success, complete, failed).
 */
type TimelineItem =
  | {
      type: "delivery";
      occurredAt: string;
      deliveryId: string;
      summary: string;
    }
  | {
      type: "followup";
      occurredAt: string;
      followupId: string;
      kind: string;
      deliveryId: string;
    }
  | {
      type: "gap";
      scheduledFor: string;
      deliveryId: string;
      label: string;
      status: "missing" | "upcoming";
      daysFromDelivery: number;
    }
  | {
      type: "window";
      openedAt: string;
      closesAt: string;
      label: string;
      status: "open" | "closed" | "expired";
    };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normalize location fields from loosely-typed payloads.
 * This is display-only logic and intentionally forgiving.
 */
function normalizeLocation(loc: unknown): string {
  if (!loc) return "community";
  if (typeof loc === "string") return loc;
  if (typeof loc === "object") {
    const anyLoc = loc as any;
    return anyLoc.community ?? anyLoc.name ?? anyLoc.region ?? "community";
  }
  return "community";
}

/* -------------------------------------------------------------------------- */
/* Timeline Service                                                           */
/* -------------------------------------------------------------------------- */

export class TimelineService {
  /**
   * Ledger is the ONLY source of truth.
   * This service treats it as immutable input.
   */
  private ledger = new LedgerService();

  /**
   * Build a verified timeline for a project (case).
   *
   * SCALABILITY NOTES
   * -----------------
   * - O(n) over ledger entries
   * - Deterministic and stateless
   * - Safe to cache at API layer
   * - Fully recomputable at any time
   *
   * If this grows large:
   * - paginate ledger reads
   * - pre-project windows separately
   */
  async build(projectId: string) {
    const entries = await this.ledger.listByProject(projectId);
    const now = Date.now();

    /* ---------------------------------------------------------------------- */
    /* Partition ledger entries                                                */
    /* ---------------------------------------------------------------------- */

    /**
     * IMPORTANT:
     * Ledger uses `eventType`, not `type`.
     * We never rely on payload shape for classification.
     */
    const deliveries = entries.filter(
      (e: any) => String(e.eventType) === "DELIVERY_RECORDED",
    );

    const followups = entries.filter(
      (e: any) => String(e.eventType) === "FOLLOWUP_RECORDED",
    );

    const windowOpened = entries.filter(
      (e: any) => String(e.eventType) === "WINDOW_OPENED",
    );

    const windowClosed = entries.filter(
      (e: any) => String(e.eventType) === "WINDOW_CLOSED",
    );

    deliveries.sort((a: any, b: any) => Number(a.ts) - Number(b.ts));
    followups.sort((a: any, b: any) => Number(a.ts) - Number(b.ts));

    const items: TimelineItem[] = [];

    /* ---------------------------------------------------------------------- */
    /* VERIFIED WINDOWS (Ledger-Backed Observation Periods)                    */
    /* ---------------------------------------------------------------------- */

    /**
     * Windows are CASE-SCOPED facts.
     *
     * - They are opened explicitly via ledger events.
     * - They may be closed explicitly.
     * - Expiration is derived at read-time.
     *
     * The ledger does NOT store window status.
     */
    const windowsById = new Map<
      string,
      {
        openedAt: number;
        closesAt: number;
        label: string;
        closedAt?: number;
      }
    >();

    for (const w of windowOpened) {
      const p = w.payload as any;
      if (!p?.windowId || !p?.expectedDays) continue;

      const openedAt = Number(w.ts);
      const closesAt = openedAt + p.expectedDays * 86400000;

      windowsById.set(String(p.windowId), {
        openedAt,
        closesAt,
        label: String(p.label ?? "window"),
      });
    }

    for (const w of windowClosed) {
      const p = w.payload as any;
      const id = String(p?.windowId ?? "");
      const win = windowsById.get(id);
      if (win) {
        win.closedAt = Number(w.ts);
      }
    }

    /**
     * Project windows into timeline items.
     * This is where "verified timeline" becomes human-readable.
     */
    for (const win of windowsById.values()) {
      let status: "open" | "closed" | "expired" = "open";

      if (win.closedAt) {
        status = "closed";
      } else if (now > win.closesAt) {
        status = "expired";
      }

      items.push({
        type: "window",
        openedAt: new Date(win.openedAt).toISOString(),
        closesAt: new Date(win.closesAt).toISOString(),
        label: win.label,
        status,
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Deliveries, Followups, and Derived Gaps                                 */
    /* ---------------------------------------------------------------------- */

    /**
     * Gaps are EXPECTATION-BASED projections.
     * They are NOT ledger-backed facts.
     *
     * This distinction is intentional and critical.
     */
    for (const d of deliveries) {
      const delivery = (d.payload ?? {}) as any;
      const deliveryId = String(delivery.deliveryId ?? "");

      items.push({
        type: "delivery",
        occurredAt: new Date(Number(d.ts)).toISOString(),
        deliveryId,
        summary: `${delivery.items?.length ?? 0} item types delivered to ${normalizeLocation(
          delivery.location,
        )}`,
      });

      const deliveryTime = Number(d.ts);

      const relatedFollowups = followups.filter(
        (f: any) => String((f.payload as any)?.deliveryId ?? "") === deliveryId,
      );

      const usedFollowupIds = new Set<string>();

      for (const daysFromDelivery of FOLLOWUP_SCHEDULE_DAYS) {
        const scheduledMs = deliveryTime + daysFromDelivery * 86400000;
        const scheduledFor = new Date(scheduledMs).toISOString();

        const windowStart = scheduledMs - FOLLOWUP_WINDOW_DAYS * 86400000;
        const windowEnd = scheduledMs + FOLLOWUP_WINDOW_DAYS * 86400000;

        const matched = relatedFollowups.find((f: any) => {
          const fu = f.payload as any;
          if (!fu?.followupId) return false;
          if (usedFollowupIds.has(String(fu.followupId))) return false;

          const t = Number(f.ts);
          return t >= windowStart && t <= windowEnd;
        });

        if (matched) {
          usedFollowupIds.add(String((matched.payload as any).followupId));
        } else {
          items.push({
            type: "gap",
            scheduledFor,
            deliveryId,
            label: `${daysFromDelivery}-day follow-up`,
            status: scheduledMs <= now ? "missing" : "upcoming",
            daysFromDelivery,
          });
        }
      }

      for (const f of relatedFollowups) {
        const fu = f.payload as any;
        items.push({
          type: "followup",
          occurredAt: new Date(Number(f.ts)).toISOString(),
          followupId: String(fu.followupId ?? ""),
          kind: String(fu.kind ?? ""),
          deliveryId: String(fu.deliveryId ?? deliveryId),
        });
      }
    }

    /* ---------------------------------------------------------------------- */
    /* Ordering & Summary                                                      */
    /* ---------------------------------------------------------------------- */

    /**
     * Timeline ordering is deterministic and stable.
     * No implicit prioritization beyond timestamps.
     */
    items.sort((a, b) => {
      const ta =
        a.type === "gap"
          ? a.scheduledFor
          : a.type === "window"
            ? a.openedAt
            : a.occurredAt;

      const tb =
        b.type === "gap"
          ? b.scheduledFor
          : b.type === "window"
            ? b.openedAt
            : b.occurredAt;

      return ta.localeCompare(tb);
    });

    const gaps = items.filter((x) => x.type === "gap");
    const missingGaps = gaps.filter((g) => g.status === "missing");

    /* ---------------------------------------------------------------------- */
    /* Final Response                                                          */
    /* ---------------------------------------------------------------------- */

    return {
      ok: true,
      projectId,
      scheduleDays: [...FOLLOWUP_SCHEDULE_DAYS],
      windowDays: FOLLOWUP_WINDOW_DAYS,
      timeline: items,
      counts: {
        deliveries: deliveries.length,
        followups: followups.length,
        gaps: gaps.length,
        missingGaps: missingGaps.length,
        upcomingGaps: gaps.length - missingGaps.length,
      },
    };
  }
}
