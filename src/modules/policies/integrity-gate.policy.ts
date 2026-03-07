import { IntegrityService } from "@/modules/intake/intergrity/integrity.service";
import { TrustContext } from "@/modules/auth/trust/trust.context";

/**
 * Governance integrity gate.
 * Evaluates anomaly flags before intake proceeds.
 */
export async function enforceIntegrityGate(
  integrityService: IntegrityService,
  message: string,
  trust: TrustContext,
) {
  const flags = await integrityService.performFullAudit(
    { beneficiaryId: null } as any,
    message,
    trust.deviceId,
    trust.isTrusted,
  );

  const hasHighAnomaly = flags.some((f) => f.severity === "HIGH");

  if (hasHighAnomaly && !trust.isTrusted) {
    const err: any = new Error("INTAKE_BLOCKED_HIGH_SEVERITY_ANOMALY");
    err.flags = flags;
    throw err;
  }

  return flags;
}
