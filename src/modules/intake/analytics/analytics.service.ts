// apps/backend/src/modules/routing/analytics.service.ts
import { LedgerService } from "../intake/ledger.service";

export class AnalyticsService {
  constructor(private ledgerService: LedgerService) {}

  /**
   * Section O.2: Publicly track response speeds
   *
   * NOTE:
   * - Measures time between two factual ledger events
   * - Does NOT infer task, lifecycle, or workflow state
   */
  async calculateLatency(postWinId: string): Promise<number> {
    const trail = await this.ledgerService.getAuditTrail(postWinId);

    // factual intake record (creation / receipt)
    const intake = trail.find((t) => t.action === "INTAKE_RECEIVED");

    // factual execution completion record
    const execution = trail.find((t) => t.action === "EXECUTION_COMPLETED");

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
