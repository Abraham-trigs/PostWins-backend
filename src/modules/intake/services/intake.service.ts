import { OperationalMode, AccessScope, CaseType } from "@prisma/client";
import { TaskService } from "../../routing/structuring/task.service";
import { IntegrityService } from "../intergrity/integrity.service";
import { IntakeMetadata, IntakeResult } from "../domain/intake.types";
import { detectContext } from "../domain/intake.context.detector";
import { TrustContext } from "@/modules/auth/trust/trust.context";
import { resolveGhanaPostAddress } from "../domain/ghanaPost.resolver";
import { enforceIntegrityGate } from "../../policies/integrity-gate.policy";

export class IntakeService {
  constructor(
    private integrityService: IntegrityService,
    private taskService: TaskService,
  ) {}

  public async handleIntake(
    message: string,
    trust: TrustContext,
  ): Promise<IntakeResult> {
    const normalizedMessage = this.sanitizeDescription(message);
    const ctx = await detectContext(normalizedMessage);

    const intakeMeta: Partial<IntakeMetadata> = {
      mode: OperationalMode.ASSISTED,
      scope:
        ctx.role === "NGO_PARTNER" ? AccessScope.PARTNER : AccessScope.PUBLIC,
      intent: CaseType.REQUEST,
    };

    if (!intakeMeta.mode || !intakeMeta.scope || !intakeMeta.intent) {
      throw new Error("INTAKE_METADATA_INCOMPLETE");
    }

    // 🚀 Use the externalized functional guard
    await enforceIntegrityGate(this.integrityService, normalizedMessage, trust);

    return {
      mode: intakeMeta.mode,
      scope: intakeMeta.scope,
      intent: intakeMeta.intent,
      description: normalizedMessage,
      literacyLevel: ctx.literacyLevel,
    };
  }

  /**
   * 🚀 Proxy to the standalone location helper.
   * Fixes: "Property 'resolveGhanaPostAddress' does not exist on type 'IntakeService'"
   */
  public async resolveGhanaPostAddress(digitalAddress: string) {
    return resolveGhanaPostAddress(digitalAddress);
  }

  public sanitizeDescription(message: string): string {
    return message.trim().replace(/\s+/g, " ");
  }
}
