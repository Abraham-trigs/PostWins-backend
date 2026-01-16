import { IntegrityFlag, PostWin } from "@posta/core";
export declare class IntegrityService {
    private processedHashes;
    private deviceRegistry;
    private lastActivity;
    private violationCounters;
    private blacklist;
    private registryPath;
    private blacklistPath;
    private dataDir;
    private idempotencyPath;
    private readonly COOLDOWN_MS;
    private readonly MAX_VIOLATIONS;
    constructor();
    /**
     * Section F & M: Multi-layered integrity check with Blacklist Enforcement
     */
    performFullAudit(postWin: PostWin, rawMessage: string, deviceId?: string): Promise<IntegrityFlag[]>;
    private handleViolation;
    private checkCooldown;
    checkDuplicate(message: string): IntegrityFlag | null;
    private detectGhostBeneficiary;
    private isAdversarial;
    /**
     * Get an idempotency record by key.
     * Returns null if not found.
     */
    get(key: string): Promise<{
        requestHash: string;
        response: unknown;
    } | null>;
    /**
     * Save an idempotency record (key -> requestHash + response).
     * This allows safe retry + replay across restarts.
     */
    save(key: string, requestHash: string, response: unknown): Promise<void>;
    private ensureIdempotencyFile;
    private loadIdempotency;
    private writeIdempotency;
    private ensureDir;
    private saveRegistry;
    private saveBlacklist;
    private loadRegistry;
    private loadBlacklist;
}
//# sourceMappingURL=integrity.service.d.ts.map