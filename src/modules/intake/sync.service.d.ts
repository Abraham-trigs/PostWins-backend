import { PostWin, LedgerCommitment } from "@posta/core";
import { LedgerService } from "./ledger.service";
export declare class SyncService {
    private ledgerService;
    constructor(ledgerService: LedgerService);
    /**
     * Section K: Automatically queue and sync data
     */
    processSyncQueue(incomingPostWins: PostWin[]): Promise<LedgerCommitment[]>;
}
//# sourceMappingURL=sync.service.d.ts.map