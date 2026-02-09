import { prisma } from "../../lib/prisma";
import { EnsureVerificationInput } from "./verification-request.types";

export class VerificationOrchestrator {
  /**
   * Ensure a verification agreement exists for a claim.
   * Safe to call anytime. Fully idempotent.
   */
  async ensureVerification(input: EnsureVerificationInput) {
    const { tenantId, caseId, requiredRoleKeys, requiredVerifiers } = input;

    // 1️⃣ Check if an open verification already exists
    const existing = await prisma.verificationRecord.findFirst({
      where: {
        tenantId,
        caseId,
        consensusReached: false,
      },
      include: {
        requiredRoles: true,
      },
    });

    if (existing) {
      return existing; // 🔁 idempotent reuse
    }

    // 2️⃣ Create new verification record
    const verificationRecord = await prisma.verificationRecord.create({
      data: {
        tenantId,
        caseId,
        requiredVerifiers,
        routedAt: new Date(),
      },
    });

    // 3️⃣ Attach required roles deterministically
    await prisma.verificationRequiredRole.createMany({
      data: requiredRoleKeys.map((roleKey) => ({
        verificationRecordId: verificationRecord.id,
        roleKey,
      })),
      skipDuplicates: true,
    });

    return verificationRecord;
  }
}
