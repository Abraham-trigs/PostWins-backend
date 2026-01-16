import { FOLLOWUP_SCHEDULE_DAYS, FOLLOWUP_WINDOW_DAYS } from "../../utils/postwins.paths";
import { LedgerService } from "../intake/ledger.service";

type TimelineItem =
  | { type: "delivery"; occurredAt: string; deliveryId: string; summary: string }
  | { type: "followup"; occurredAt: string; followupId: string; kind: string; deliveryId: string }
  | {
      type: "gap";
      scheduledFor: string;
      deliveryId: string;
      label: string;
      status: "missing" | "upcoming";
      daysFromDelivery: number;
    };

export class TimelineService {
  private ledger = new LedgerService();

  async build(projectId: string) {
    const entries = await this.ledger.listByProject(projectId);

    const deliveries = entries.filter((e: any) => e.type === "DELIVERY_RECORDED");
    const followups = entries.filter((e: any) => e.type === "FOLLOWUP_RECORDED");

    deliveries.sort((a: any, b: any) => a.occurredAt.localeCompare(b.occurredAt));
    followups.sort((a: any, b: any) => a.occurredAt.localeCompare(b.occurredAt));

    const items: TimelineItem[] = [];
    const now = Date.now();

    for (const d of deliveries) {
      const delivery = d.payload as any;
      const deliveryId = delivery.deliveryId as string;

      items.push({
        type: "delivery",
        occurredAt: d.occurredAt,
        deliveryId,
        summary: `${(delivery.items?.length ?? 0)} item types delivered to ${
          delivery.location?.community ?? "community"
        }`,
      });

      const deliveryTime = new Date(d.occurredAt).getTime();

      // Only consider followups tied to this delivery
      const relatedFollowups = followups.filter((f: any) => (f.payload as any).deliveryId === deliveryId);

      // Prevent one follow-up from satisfying multiple schedule slots
      const usedFollowupIds = new Set<string>();

      for (const daysFromDelivery of FOLLOWUP_SCHEDULE_DAYS) {
        const scheduledFor = new Date(deliveryTime + daysFromDelivery * 86400000).toISOString();
        const scheduledMs = new Date(scheduledFor).getTime();

        const windowStart = scheduledMs - FOLLOWUP_WINDOW_DAYS * 86400000;
        const windowEnd = scheduledMs + FOLLOWUP_WINDOW_DAYS * 86400000;

        const matched = relatedFollowups.find((f: any) => {
          const fu = f.payload as any;
          if (!fu?.followupId) return false;
          if (usedFollowupIds.has(fu.followupId)) return false;

          const t = new Date(f.occurredAt).getTime();
          return t >= windowStart && t <= windowEnd;
        });

        if (matched) {
          const fu = matched.payload as any;
          usedFollowupIds.add(fu.followupId);
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

      // Add actual follow-ups (so UI sees reality even if outside windows)
      for (const f of relatedFollowups) {
        const fu = f.payload as any;
        items.push({
          type: "followup",
          occurredAt: f.occurredAt,
          followupId: fu.followupId,
          kind: fu.kind,
          deliveryId: fu.deliveryId,
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
