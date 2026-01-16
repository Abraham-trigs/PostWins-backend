type TimelineItem = {
    type: "delivery";
    occurredAt: string;
    deliveryId: string;
    summary: string;
} | {
    type: "followup";
    occurredAt: string;
    followupId: string;
    kind: string;
    deliveryId: string;
} | {
    type: "gap";
    scheduledFor: string;
    deliveryId: string;
    label: string;
    status: "missing" | "upcoming";
    daysFromDelivery: number;
};
export declare class TimelineService {
    private ledger;
    build(projectId: string): Promise<{
        ok: boolean;
        projectId: string;
        scheduleDays: (30 | 90 | 180)[];
        windowDays: number;
        timeline: TimelineItem[];
        counts: {
            deliveries: number;
            followups: number;
            gaps: number;
            missingGaps: number;
            upcomingGaps: number;
        };
    }>;
}
export {};
//# sourceMappingURL=timeline.service.d.ts.map