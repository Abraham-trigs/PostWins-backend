// apps/backend/src/modules/timeline/timeline.service.ts
import {
  FOLLOWUP_SCHEDULE_DAYS,
  FOLLOWUP_WINDOW_DAYS,
} from "../../utils/postwins.paths";
import { LedgerService } from "../intake/ledger.service";

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
    };

function normalizeLocation(loc: unknown): string {
  if (!loc) return "community";
  if (typeof loc === "string") return loc;
  if (typeof loc === "object") {
    const anyLoc = loc as any;
    return anyLoc.community ?? anyLoc.name ?? anyLoc.region ?? "community";
  }
  return "community";
}

export class TimelineService {
  private ledger = new LedgerService();

  async build(projectId: string) {
    const entries = await this.ledger.listByProject(projectId);

    // ✅ ledger rows use eventType, not type
    const deliveries = entries.filter(
      (e: any) => String(e.eventType) === "DELIVERY_RECORDED",
    );
    const followups = entries.filter(
      (e: any) => String(e.eventType) === "FOLLOWUP_RECORDED",
    );

    deliveries.sort((a: any, b: any) => Number(a.ts) - Number(b.ts));
    followups.sort((a: any, b: any) => Number(a.ts) - Number(b.ts));

    const items: TimelineItem[] = [];
    const now = Date.now();

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
        const scheduledFor = new Date(
          deliveryTime + daysFromDelivery * 86400000,
        ).toISOString();
        const scheduledMs = new Date(scheduledFor).getTime();

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
          const fu = matched.payload as any;
          usedFollowupIds.add(String(fu.followupId));
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

    items.sort((a, b) => {
      const ta = a.type === "gap" ? a.scheduledFor : a.occurredAt;
      const tb = b.type === "gap" ? b.scheduledFor : b.occurredAt;
      return ta.localeCompare(tb);
    });

    const gaps = items.filter((x) => x.type === "gap");
    const missingGaps = gaps.filter((g) => g.status === "missing");

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
