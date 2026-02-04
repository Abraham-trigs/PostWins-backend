// apps/backend/src/modules/routing/analytics.service.ts
import { LedgerService } from "../intake/ledger.service";

export class AnalyticsService {
  constructor(private ledgerService: LedgerService) {}

  /**
   * Section O.2: Publicly track response speeds (Intake -> Execution)
   */
  async calculateLatency(postWinId: string): Promise<number> {
    const trail = await this.ledgerService.getAuditTrail(postWinId);
    const intake = trail.find((t) => t.action === "INTAKE");
    const execution = trail.find((t) => t.action === "EXECUTED");

    const toMs = (v: number | bigint | undefined) => {
      if (typeof v === "bigint") return Number(v);
      if (typeof v === "number") return v;
      return undefined;
    };

    const intakeTs = toMs(intake?.ts);
    const executionTs = toMs(execution?.ts);

    if (intakeTs == null || executionTs == null) return 0;

    return executionTs - intakeTs;
  }
}
