import { LedgerService } from "../intake/ledger.service";
export declare class AnalyticsService {
    private ledgerService;
    constructor(ledgerService: LedgerService);
    /**
     * Section O.2: Publicly track response speeds (Intake -> Execution)
     */
    calculateLatency(postWinId: string): number;
}
//# sourceMappingURL=analytics.service.d.ts.map