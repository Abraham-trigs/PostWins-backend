// apps/backend/src/modules/verification/verification.service.ts
import { PostWin, VerificationRecord, AuditRecord } from "@posta/core";
import { LedgerService } from "../intake/ledger.service";

export class VerificationService {
  constructor(private ledgerService: LedgerService) {}

  /**
   * SECTION D: Retrieve PostWin state from Ledger
   * Resolves the underline in VerificationController
   */
  public async getPostWinById(postWinId: string): Promise<PostWin | null> {
    const trail = this.ledgerService.getAuditTrail(postWinId);
    if (trail.length === 0) return null;

    // Find the original intake to get the author/beneficiary details
    const intake = trail.find(r => r.action === 'INTAKE');

    // Reconstruct the entity to match PostWin interface exactly
    const reconstructed: PostWin = {
      id: postWinId,
      taskId: 'ENROLL', // Default step
      routingStatus: 'FALLBACK',
      verificationStatus: (trail[trail.length - 1].newState as any).replace('STATUS_', '') || 'PENDING',
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
  async recordVerification(postWin: PostWin, verifierId: string, sdgGoal: string): Promise<PostWin> {
    // 1. Initialize records to satisfy PostWin interface
    if (!postWin.verificationRecords) {
      postWin.verificationRecords = [];
    }

    const record = postWin.verificationRecords.find(r => r.sdgGoal === sdgGoal);
    
    if (!record) throw new Error(`Verification target ${sdgGoal} not found.`);
    if (record.consensusReached) return postWin;

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
