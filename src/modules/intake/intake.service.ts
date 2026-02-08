import { PostWin, PostaContext, AuditRecord } from "@posta/core";
import { IntegrityService } from "./integrity.service";
import { TaskService } from "../routing/structuring/task.service";

/**
 * Interface to extend PostaContext with literacy metadata for ToneAdapter
 */
export interface EnrichedContext extends PostaContext {
  literacyLevel: "LOW" | "STANDARD";
  intent: string;
}

export class IntakeService {
  constructor(
    private integrityService: IntegrityService,
    private taskService: TaskService,
  ) {}

  /**
   * ✅ Canonical public entrypoint for intake
   * Used by controllers + mock engine + future offline sync.
   */
  public async handleIntake(
    message: string,
    deviceId: string,
  ): Promise<Partial<PostWin>> {
    const ctx = await this.detectContext(message);

    // This already performs integrity audit + returns partial fields
    const partial = await this.processInternalOrchestration(message, deviceId);

    const audit: AuditRecord = {
      timestamp: Date.now(),
      action: "INTAKE_RECEIVED",
      actor: deviceId,
      note: `role=${ctx.role}, literacy=${ctx.literacyLevel}, intent=${ctx.intent}`,
    };

    return {
      ...partial,

      // Keep these stable for downstream pipeline expectations:
      auditTrail: [...(partial.auditTrail ?? []), audit],

      // Optional but helpful (only if PostWin allows it)
      context: ctx as unknown as PostaContext,

      // If your pipeline expects an initial taskId, set a safe default
      taskId: (partial as any).taskId ?? "START",
    };
  }

  /**
   * Section A & N: Implicit Context & Literacy Detection
   * Analyzes the message to determine role and literacy level (Requirement G.2)
   */
  public async detectContext(message: string): Promise<EnrichedContext> {
    const msg = message.toLowerCase();

    // 1. Role Detection (Requirement A.1)
    let role: PostaContext["role"] = "BENEFICIARY";
    if (
      msg.includes("partner") ||
      msg.includes("organization") ||
      msg.includes("ngo")
    ) {
      role = "NGO_PARTNER";
    }

    // 2. Literacy Scoring (Requirement G.2)
    const words = message.trim().split(/\s+/);
    const avgWordLength = message.length / (words.length || 1);

    const literacyLevel =
      words.length < 6 || avgWordLength < 4 ? "LOW" : "STANDARD";

    return {
      role,
      isImplicit: true,
      literacyLevel,
      intent: "CLAIM_SUBMISSION",
    };
  }

  public sanitizeDescription(message: string): string {
    return message.trim().replace(/\s+/g, " ");
  }

  async processInternalOrchestration(
    message: string,
    deviceId: string,
  ): Promise<Partial<PostWin>> {
    const context = await this.detectContext(message);

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
      mode: "AI_AUGMENTED",
      routingStatus: "UNASSIGNED",
    };
  }

  /**
   * Resolve GhanaPost Digital Address → GPS coordinates
   * Used by web intake questionnaire (Step 1)
   */
  public async resolveGhanaPostAddress(digitalAddress: string): Promise<{
    digitalAddress: string;
    lat: number;
    lng: number;
    bounds: [[number, number], [number, number]];
  }> {
    // GhanaPost format sanity check
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

    // Conservative bounding box (~50m)
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
