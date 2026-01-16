import { PostWin } from "@posta/core";
import { LedgerService } from "../intake/ledger.service";
export declare class VerificationService {
    private ledgerService;
    constructor(ledgerService: LedgerService);
    /**
     * SECTION D: Retrieve PostWin state from Ledger
     * Resolves the underline in VerificationController
     */
    getPostWinById(postWinId: string): Promise<PostWin | null>;
    /**
     * SECTION D.5: Consensus Logic & Multi-Verifier tracking
     */
    recordVerification(postWin: PostWin, verifierId: string, sdgGoal: string): Promise<PostWin>;
}
//# sourceMappingURL=verification.controller.d.ts.map