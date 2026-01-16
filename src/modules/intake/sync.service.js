"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncService = void 0;
class SyncService {
    ledgerService;
    constructor(ledgerService) {
        this.ledgerService = ledgerService;
    }
    /**
     * Section K: Automatically queue and sync data
     */
    async processSyncQueue(incomingPostWins) {
        const commitments = [];
        for (const pw of incomingPostWins) {
            // Create an immutable record of the sync event
            const commitment = await this.ledgerService.commit({
                timestamp: Date.now(),
                postWinId: pw.id,
                action: 'INTAKE',
                actorId: 'OFFLINE_SYNC_ENGINE',
                previousState: 'LOCAL_STORAGE',
                newState: 'SYNCED'
            });
            commitments.push(commitment);
        }
        return commitments;
    }
}
exports.SyncService = SyncService;
