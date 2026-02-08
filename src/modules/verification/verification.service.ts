import { PostWin } from "@posta/core";
import { LedgerService } from "../intake/ledger.service";
import { CaseLifecycle } from "@prisma/client";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";

export class VerificationService {
  constructor(private ledgerService: LedgerService) {}

  /**
   * SECTION D: Retrieve PostWin state from Ledger
   * Resolves the underline in VerificationController
   */
  public async getPostWinById(postWinId: string): Promise<PostWin | null> {
    const trail = await this.ledgerService.getAuditTrail(postWinId);
    if (trail.length === 0) return null;

    // Pull bootstrap snapshot from timeline ledger (where we seed verificationRecords)
    const timeline = await this.ledgerService.listByPostWinId(postWinId);
    const bootstrap = timeline.find(
      (e: any) => e?.eventType === "POSTWIN_BOOTSTRAPPED",
    );
    const payload = bootstrap?.payload ?? {};
    const payloadAny = payload as any;

    // Find the original intake to get the author/beneficiary details
    const intake = trail.find((r: any) => r.action === "INTAKE");

    const reconstructed: PostWin = {
      id: postWinId,
      taskId: "ENROLL",
      routingStatus: "FALLBACK",
      verificationStatus:
        (trail[trail.length - 1].newState as any)?.replace?.("STATUS_", "") ||
        "PENDING",
      verificationRecords: Array.isArray(payloadAny.verificationRecords)
        ? payloadAny.verificationRecords
        : [],
      auditTrail: trail.map((r: any) => {
        const ts =
          r.ts == null
            ? Date.now()
            : typeof r.ts === "bigint"
              ? Number(r.ts)
              : r.ts;

        return {
          action: r.action,
          actor: r.actorId,
          timestamp: new Date(ts).toISOString(),
          note: "Reconstructed from ledger",
        };
      }),
      description: payloadAny.narrative || "Reconstructed record",
      beneficiaryId: payloadAny.beneficiaryId || intake?.actorId || "unknown",
      authorId: payloadAny.beneficiaryId || intake?.actorId || "unknown",
      sdgGoals: Array.isArray(payloadAny.sdgGoals)
        ? payloadAny.sdgGoals
        : ["SDG_4", "SDG_5"],
      mode: "AI_AUGMENTED",
    };

    return reconstructed;
  }

  /**
   * SECTION D.5: Consensus Logic & Multi-Verifier tracking
   */
  async recordVerification(
    postWin: PostWin,
    verifierId: string,
    sdgGoal: string,
  ): Promise<PostWin> {
    if (!postWin.verificationRecords) {
      postWin.verificationRecords = [];
    }

    const record = postWin.verificationRecords.find(
      (r) => r.sdgGoal === sdgGoal,
    );

    if (!record) throw new Error(`Verification target ${sdgGoal} not found.`);
    if (record.consensusReached) return postWin;

    if (verifierId === postWin.beneficiaryId) {
      throw new Error("Authors cannot self-verify claims.");
    }

    record.receivedVerifications ??= [];
    if (!record.receivedVerifications.includes(verifierId)) {
      record.receivedVerifications.push(verifierId);

      postWin.auditTrail ??= [];
      postWin.auditTrail.push({
        action: "VERIFIED",
        actor: verifierId,
        timestamp: new Date().toISOString(),
        note: `Approval recorded for ${sdgGoal}`,
      });
    }

    // ✅ DECISION POINT (quorum reached)
    if (record.receivedVerifications.length >= record.requiredVerifiers) {
      record.consensusReached = true;
      record.timestamps ??= {};
      record.timestamps.verifiedAt = new Date().toISOString();

      const previousStatus = postWin.verificationStatus;
      postWin.verificationStatus = "VERIFIED";

      // Existing PostWin ledger commit (domain narrative)
      await this.ledgerService.commit({
        ts: Date.now(),
        postWinId: postWin.id,
        action: "VERIFIED",
        actorId: verifierId,
        previousState: previousStatus,
        newState: "VERIFIED",
      });

      // ✅ Case lifecycle transition backed by ledger (authoritative)
      await transitionCaseLifecycleWithLedger({
        caseId: postWin.id, // PostWin.id === Case.id in current model
        from: CaseLifecycle.ROUTED,
        to: CaseLifecycle.VERIFIED,
        actorUserId: verifierId,
        intentContext: {
          verificationRecordId: record.id,
          sdgGoal,
        },
      });
    }

    return postWin;
  }
}
