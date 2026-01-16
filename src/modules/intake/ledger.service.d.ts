import { AuditRecord } from "@posta/core";
export declare class LedgerService {
    private auditLedgerPath;
    private dataDir;
    private timelineLedgerPath;
    private keysDir;
    private privateKeyPath;
    private publicKeyPath;
    private privateKey;
    publicKey: string;
    constructor();
    /**
     * Section L.4: Data Retrieval
     * Scans the audit ledger for all records associated with a specific PostWin.
     */
    getAuditTrail(postWinId: string): AuditRecord[];
    /**
     * Section L.1 & L.3: Records status changes, signs them, and returns the full record
     */
    commit(record: Omit<AuditRecord, "commitmentHash" | "signature">): Promise<AuditRecord>;
    /**
     * Section L.2: Deterministic SHA-256 Hashing
     */
    generateHash(data: any): string;
    /**
     * Section L.5: Verification Logic (audit ledger)
     */
    verifyLedgerIntegrity(): boolean;
    private loadAuditLedger;
    /**
     * Append a timeline entry (append-only).
     * Used by delivery / follow-up intake handlers.
     */
    appendEntry(entry: any): Promise<void>;
    /**
     * List all timeline entries for a projectId.
     * Used by /api/timeline/:projectId
     */
    listByProject(projectId: string): Promise<any[]>;
    private ensureTimelineLedger;
    private loadTimelineDb;
    private ensureDir;
    /**
     * Atomic write prevents corrupted JSON if process crashes mid-write.
     */
    private atomicWriteJson;
}
//# sourceMappingURL=ledger.service.d.ts.map