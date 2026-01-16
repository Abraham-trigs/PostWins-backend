"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerificationService = void 0;
class VerificationService {
    ledgerService;
    constructor(ledgerService) {
        this.ledgerService = ledgerService;
    }
    /**
     * SECTION D: Retrieve PostWin state from Ledger
     * Resolves the underline in VerificationController
     */
    async getPostWinById(postWinId) {
        const trail = this.ledgerService.getAuditTrail(postWinId);
        if (trail.length === 0)
            return null;
        // Find the original intake to get the author/beneficiary details
        const intake = trail.find(r => r.action === 'INTAKE');
        // Reconstruct the entity to match PostWin interface exactly
        const reconstructed = {
            id: postWinId,
            taskId: 'ENROLL', // Default step
            routingStatus: 'FALLBACK',
            verificationStatus: trail[trail.length - 1].newState.replace('STATUS_', '') || 'PENDING',
            verificationRecords: [],
            auditTrail: trail.map(r => ({
                action: r.action,
                actor: r.actorId,
                timestamp: new Date(r.timestamp).toISOString(),
                note: "Reconstructed from ledger"
            })),
            description: "Reconstructed record",
            beneficiaryId: intake?.actorId || 'unknown',
            authorId: intake?.actorId || 'unknown',
            sdgGoals: ['SDG_4'],
            mode: 'AI_AUGMENTED'
        };
        return reconstructed;
    }
    /**
     * SECTION D.5: Consensus Logic & Multi-Verifier tracking
     */
    async recordVerification(postWin, verifierId, sdgGoal) {
        // 1. Initialize records to satisfy PostWin interface
        if (!postWin.verificationRecords) {
            postWin.verificationRecords = [];
        }
        const record = postWin.verificationRecords.find(r => r.sdgGoal === sdgGoal);
        if (!record)
            throw new Error(`Verification target ${sdgGoal} not found.`);
        if (record.consensusReached)
            return postWin;
        // 2. Security: Prevent self-verification (Requirement D.2)
        if (verifierId === postWin.beneficiaryId) {
            throw new Error("Authors cannot self-verify claims.");
        }
        // 3. CAPTURE VERIFICATION ATTEMPT
        if (!record.receivedVerifications.includes(verifierId)) {
            record.receivedVerifications.push(verifierId);
            // Update local trail
            postWin.auditTrail.push({
                action: 'VERIFIED',
                actor: verifierId,
                timestamp: new Date().toISOString(),
                note: `Approval recorded for ${sdgGoal}`
            });
        }
        // 4. EVALUATE CONSENSUS (Section D.5)
        if (record.receivedVerifications.length >= record.requiredVerifiers) {
            record.consensusReached = true;
            record.timestamps.verifiedAt = new Date().toISOString();
            const previousStatus = postWin.verificationStatus;
            postWin.verificationStatus = 'VERIFIED';
            /**
             * SECTION L: Commit to Immutable Ledger
             * Pass only the core data to satisfy Omit<AuditRecord, 'commitmentHash' | 'signature'>
             */
            await this.ledgerService.commit({
                timestamp: Date.now(),
                postWinId: postWin.id,
                action: 'VERIFIED',
                actorId: verifierId,
                previousState: previousStatus,
                newState: 'VERIFIED'
            });
        }
        return postWin;
    }
}
exports.VerificationService = VerificationService;
