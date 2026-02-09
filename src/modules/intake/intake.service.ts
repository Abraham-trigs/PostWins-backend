import { PostWin, PostaContext, AuditRecord } from "@posta/core";
import { TaskId } from "../../domain/tasks/taskIds";
import { IntegrityService } from "./integrity.service";
import { TaskService } from "../routing/structuring/task.service";

/**
 * Phase 1.5 — Explicit Intake Metadata
 * -----------------------------------
 * These are resolved during intake and MUST be persisted downstream.
 */
export type IntakeMetadata = {
  mode: "MOCK" | "ASSISTED" | "AI_AUGMENTED";
  scope: "PUBLIC" | "PARTNER" | "INTERNAL";
  intent: "PROGRESS" | "REQUEST" | "EXECUTION";
};

/**
 * Interface to extend PostaContext with literacy metadata (advisory only)
 */
export interface EnrichedContext extends PostaContext {
  literacyLevel: "LOW" | "STANDARD";
}

/**
 * Guardrail — fail fast if intake metadata is incomplete.
 */
function assertIntakeMetadata(
  meta: Partial<IntakeMetadata>,
): asserts meta is IntakeMetadata {
  if (!meta.mode || !meta.scope || !meta.intent) {
    throw new Error(
      "Intake metadata must be fully resolved before persistence",
    );
  }
}

export class IntakeService {
  constructor(
    private integrityService: IntegrityService,
    private taskService: TaskService, // reserved for Phase 2
  ) {}

  /**
   * ✅ Canonical public entrypoint for intake
   * Used by controllers + mock engine + future offline sync.
   */
  public async handleIntake(
    message: string,
    deviceId: string,
  ): Promise<Partial<PostWin> & IntakeMetadata> {
    const ctx = await this.detectContext(message);

    // Phase 1.5 — resolve intake metadata once
    const intakeMeta: Partial<IntakeMetadata> = {
      mode: "AI_AUGMENTED",
      scope: ctx.role === "NGO_PARTNER" ? "PARTNER" : "PUBLIC",
      intent: "REQUEST",
    };

    assertIntakeMetadata(intakeMeta);

    // Performs integrity audit + returns partial fields
    const partial = await this.processInternalOrchestration(message, deviceId);

    const audit: AuditRecord = {
      timestamp: Date.now(),
      action: "INTAKE_RECEIVED",
      actor: deviceId,
      note: `role=${ctx.role}, literacy=${ctx.literacyLevel}, intent=${intakeMeta.intent}`,
    };

    return {
      ...partial,

      // ✅ Phase 1.5 — explicit intake metadata (to be persisted by caller)
      mode: intakeMeta.mode,
      scope: intakeMeta.scope,
      intent: intakeMeta.intent,

      // Stable downstream expectations
      auditTrail: [...(partial.auditTrail ?? []), audit],

      // Context snapshot (advisory only, non-authoritative)
      context: ctx as unknown as PostaContext,

      // Deterministic task assignment
      taskId: TaskId.START,
    };
  }

  /**
   * Section A & N: Implicit Context & Literacy Detection
   * (No persistence responsibility)
   */
  public async detectContext(message: string): Promise<EnrichedContext> {
    const msg = message.toLowerCase();

    let role: PostaContext["role"] = "BENEFICIARY";
    if (
      msg.includes("partner") ||
      msg.includes("organization") ||
      msg.includes("ngo")
    ) {
      role = "NGO_PARTNER";
    }

    const words = message.trim().split(/\s+/);
    const avgWordLength = message.length / (words.length || 1);

    const literacyLevel =
      words.length < 6 || avgWordLength < 4 ? "LOW" : "STANDARD";

    return {
      role,
      isImplicit: true,
      literacyLevel,
    };
  }

  public sanitizeDescription(message: string): string {
    return message.trim().replace(/\s+/g, " ");
  }

  async processInternalOrchestration(
    message: string,
    deviceId: string,
  ): Promise<Partial<PostWin>> {
    const tempPostWin = { beneficiaryId: "pending" } as PostWin;

    const flags = await this.integrityService.performFullAudit(
      tempPostWin,
      message,
      deviceId,
    );

    if (flags.some((f) => f.severity === "HIGH")) {
      throw new Error(
        "Intake blocked by Integrity Guardrails: High severity anomaly detected.",
      );
    }

    return {
      description: this.sanitizeDescription(message),
      verificationStatus: flags.length > 0 ? "FLAGGED" : "PENDING",
      routingStatus: "UNASSIGNED",
    };
  }

  /**
   * Resolve GhanaPost Digital Address → GPS coordinates
   */
  public async resolveGhanaPostAddress(digitalAddress: string): Promise<{
    digitalAddress: string;
    lat: number;
    lng: number;
    bounds: [[number, number], [number, number]];
  }> {
    if (!/^[A-Z]{2}-\d{3}-\d{4}$/i.test(digitalAddress)) {
      throw new Error("INVALID_ADDRESS");
    }

    const apiKey = process.env.GHANAPOST_API_KEY;
    const apiUrl = process.env.GHANAPOST_API_URL;

    if (!apiKey || !apiUrl) {
      throw new Error("CONFIG_MISSING");
    }

    const url = `${apiUrl}?digitalAddress=${encodeURIComponent(
      digitalAddress,
    )}`;

    const res = await fetch(url, {
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error("NOT_FOUND");
    }

    const data = (await res.json()) as any;
    const record = data?.Table?.[0];
    if (!record) {
      throw new Error("NOT_FOUND");
    }

    const lat = Number(record.Latitude);
    const lng = Number(record.Longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("NOT_FOUND");
    }

    const delta = 0.0005;

    return {
      digitalAddress,
      lat,
      lng,
      bounds: [
        [lat - delta, lng - delta],
        [lat + delta, lng + delta],
      ],
    };
  }
}
