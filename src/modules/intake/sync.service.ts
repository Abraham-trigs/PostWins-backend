import { PostWin, LedgerCommitment } from "@posta/core";
import { LedgerService } from "./ledger.service";

export class SyncService {
  constructor(private ledgerService: LedgerService) {}

  /**
   * Section K: Automatically queue and sync data
   */
  async processSyncQueue(incomingPostWins: PostWin[]): Promise<LedgerCommitment[]> {
    const commitments: LedgerCommitment[] = [];

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
