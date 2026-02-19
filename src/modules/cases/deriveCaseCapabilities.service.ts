import { CaseLifecycle, VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ActionCapabilityState =
  | "ACTIVE"
  | "LOCKED"
  | "COMPLETED"
  | "PENDING";

export type ActionCapability = {
  allowed: boolean;
  state: ActionCapabilityState;
  reason?: string;
};

export type CaseCapabilities = {
  record: ActionCapability;
  verify: ActionCapability;
  delivery: ActionCapability;
};

export async function deriveCaseCapabilities(params: {
  tenantId: string;
  caseId: string;
}): Promise<CaseCapabilities> {
  const { tenantId, caseId } = params;

  const c = await prisma.case.findFirstOrThrow({
    where: { id: caseId, tenantId },
    select: {
      lifecycle: true,
      execution: {
        select: { status: true },
      },
      verificationRecords: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          consensusReached: true,
          verifiedAt: true,
        },
      },
    },
  });

  const lifecycle = c.lifecycle;
  const executionStatus = c.execution?.status ?? null;
  const verification = c.verificationRecords[0] ?? null;

  // ---- RECORD ----
  const record: ActionCapability =
    lifecycle === "EXECUTING"
      ? { allowed: true, state: "ACTIVE" }
      : {
          allowed: false,
          state: "LOCKED",
          reason: "Not in execution stage",
        };

  // ---- VERIFY ----
  let verify: ActionCapability;

  if (lifecycle !== "EXECUTING") {
    verify = {
      allowed: false,
      state: "LOCKED",
      reason: "Verification not available in current stage",
    };
  } else if (!executionStatus || executionStatus !== "COMPLETED") {
    verify = {
      allowed: false,
      state: "LOCKED",
      reason: "Execution not completed",
    };
  } else if (verification?.consensusReached) {
    verify = {
      allowed: false,
      state: "COMPLETED",
      reason: "Verification finalized",
    };
  } else {
    verify = {
      allowed: true,
      state: "ACTIVE",
    };
  }

  // ---- DELIVERY ----
  const delivery: ActionCapability =
    lifecycle === "VERIFIED"
      ? { allowed: true, state: "ACTIVE" }
      : {
          allowed: false,
          state: "LOCKED",
          reason: "Requires verification",
        };

  return { record, verify, delivery };
}
