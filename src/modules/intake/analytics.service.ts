// apps/backend/src/modules/routing/analytics.service.ts
import { LedgerService } from "../intake/ledger.service";

export class AnalyticsService {
  constructor(private ledgerService: LedgerService) {}

  /**
   * Section O.2: Publicly track response speeds (Intake -> Execution)
   */
  calculateLatency(postWinId: string): number {
    const trail = this.ledgerService.getAuditTrail(postWinId);
    const intake = trail.find(t => t.action === 'INTAKE');
    const execution = trail.find(t => t.action === 'EXECUTED');

    if (!intake || !execution) return -1; // Still in progress
    return execution.timestamp - intake.timestamp;
  }
}
