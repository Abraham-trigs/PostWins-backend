import { prisma } from "@/lib/prisma";
import { CaseLifecycle } from "../cases/CaseLifecycle";
import { transitionCaseLifecycleWithLedger } from "../cases/transitionCaseLifecycleWithLedger";

/**
 * Verification Orchestrator
 *
 * 🔒 Authority boundary:
 * - Consumes VERIFIED facts
 * - Decides lifecycle transition
 * - Enforces ledger-backed state change
 *
 * NOTE:
 * This orchestrator performs NO writes itself.
 * All mutation + atomicity is delegated to
 * transitionCaseLifecycleWithLedger.
 */
export async function finalizeVerification(params: {
  tenantId: string;
  caseId: string;
  actor: {
    kind: "HUMAN" | "SYSTEM";
    userId?: string;
  };
  verificationRecordId: string;
}) {
  const { tenantId, caseId, actor, verificationRecordId } = params;

  // 1️⃣ Guard: ensure verification consensus exists (read-only)
  const record = await prisma.verificationRecord.findFirst({
    where: {
      id: verificationRecordId,
      caseId,
      consensusReached: true,
    },
  });

  if (!record) {
    throw new Error("Verification consensus not reached");
  }

  // 2️⃣ Enforced lifecycle transition (lawful, atomic, ledger-backed)
  await transitionCaseLifecycleWithLedger({
    tenantId,
    caseId,
    target: CaseLifecycle.VERIFIED,
    actor: {
      kind: actor.kind,
      userId: actor.userId,
      authorityProof: "VERIFICATION_CONSENSUS",
    },
    intentContext: {
      verificationRecordId,
    },
  });
}
