"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimelineService = void 0;
const postwins_paths_1 = require("../../utils/postwins.paths");
const ledger_service_1 = require("../intake/ledger.service");
class TimelineService {
    ledger = new ledger_service_1.LedgerService();
    async build(projectId) {
        const entries = await this.ledger.listByProject(projectId);
        const deliveries = entries.filter((e) => e.type === "DELIVERY_RECORDED");
        const followups = entries.filter((e) => e.type === "FOLLOWUP_RECORDED");
        deliveries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
        followups.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
        const items = [];
        const now = Date.now();
        for (const d of deliveries) {
            const delivery = d.payload;
            const deliveryId = delivery.deliveryId;
            items.push({
                type: "delivery",
                occurredAt: d.occurredAt,
                deliveryId,
                summary: `${(delivery.items?.length ?? 0)} item types delivered to ${delivery.location?.community ?? "community"}`,
            });
            const deliveryTime = new Date(d.occurredAt).getTime();
            // Only consider followups tied to this delivery
            const relatedFollowups = followups.filter((f) => f.payload.deliveryId === deliveryId);
            // Prevent one follow-up from satisfying multiple schedule slots
            const usedFollowupIds = new Set();
            for (const daysFromDelivery of postwins_paths_1.FOLLOWUP_SCHEDULE_DAYS) {
                const scheduledFor = new Date(deliveryTime + daysFromDelivery * 86400000).toISOString();
                const scheduledMs = new Date(scheduledFor).getTime();
                const windowStart = scheduledMs - postwins_paths_1.FOLLOWUP_WINDOW_DAYS * 86400000;
                const windowEnd = scheduledMs + postwins_paths_1.FOLLOWUP_WINDOW_DAYS * 86400000;
                const matched = relatedFollowups.find((f) => {
                    const fu = f.payload;
                    if (!fu?.followupId)
                        return false;
                    if (usedFollowupIds.has(fu.followupId))
                        return false;
                    const t = new Date(f.occurredAt).getTime();
                    return t >= windowStart && t <= windowEnd;
                });
                if (matched) {
                    const fu = matched.payload;
                    usedFollowupIds.add(fu.followupId);
                }
                else {
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
                const fu = f.payload;
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
            scheduleDays: [...postwins_paths_1.FOLLOWUP_SCHEDULE_DAYS],
            windowDays: postwins_paths_1.FOLLOWUP_WINDOW_DAYS,
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
exports.TimelineService = TimelineService;
