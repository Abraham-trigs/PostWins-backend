"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
class AnalyticsService {
    ledgerService;
    constructor(ledgerService) {
        this.ledgerService = ledgerService;
    }
    /**
     * Section O.2: Publicly track response speeds (Intake -> Execution)
     */
    calculateLatency(postWinId) {
        const trail = this.ledgerService.getAuditTrail(postWinId);
        const intake = trail.find(t => t.action === 'INTAKE');
        const execution = trail.find(t => t.action === 'EXECUTED');
        if (!intake || !execution)
            return -1; // Still in progress
        return execution.timestamp - intake.timestamp;
    }
}
exports.AnalyticsService = AnalyticsService;
