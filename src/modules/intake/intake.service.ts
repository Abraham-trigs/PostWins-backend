// apps/backend/src/modules/intake/intake.service.ts
// Purpose: Canonical Intake Service aligned strictly to Prisma Case schema (no PostWin coupling).

import { OperationalMode, AccessScope, CaseType } from "@prisma/client";
import { IntegrityService } from "./intergrity/integrity.service";
import { TaskService } from "../routing/structuring/task.service";

////////////////////////////////////////////////////////////////
// Types (Schema-aligned, backend-only)
////////////////////////////////////////////////////////////////

/**
 * Explicit intake metadata that maps 1:1 to Prisma enums.
 * These must be persisted by the controller when creating Case.
 */
export type IntakeMetadata = {
  mode: OperationalMode;
  scope: AccessScope;
  intent: CaseType;
};

/**
 * Result returned from intake processing.
 * This is NOT a persisted entity — controller owns persistence.
 */
export type IntakeResult = IntakeMetadata & {
  description: string;
  literacyLevel: "LOW" | "STANDARD";
};

/**
 * Advisory context detection (not persisted unless explicitly stored).
 */
export type DetectedContext = {
  role: "AUTHOR" | "BENEFICIARY" | "VERIFIER" | "NGO_PARTNER";
  isImplicit: boolean;
  literacyLevel: "LOW" | "STANDARD";
};

////////////////////////////////////////////////////////////////
// Guards
////////////////////////////////////////////////////////////////

/**
 * Ensures intake metadata is fully resolved before controller persistence.
 */
function assertIntakeMetadata(
  meta: Partial<IntakeMetadata>,
): asserts meta is IntakeMetadata {
  if (!meta.mode || !meta.scope || !meta.intent) {
    throw new Error("INTAKE_METADATA_INCOMPLETE");
  }
}

////////////////////////////////////////////////////////////////
// Service
////////////////////////////////////////////////////////////////

export class IntakeService {
  constructor(
    private integrityService: IntegrityService,
    private taskService: TaskService, // Reserved for future deterministic orchestration
  ) {}

  /**
   * Canonical intake entrypoint.
   * - Validates metadata resolution
   * - Runs integrity guard
   * - Returns schema-aligned data only
   */
  public async handleIntake(
    message: string,
    deviceId: string,
  ): Promise<IntakeResult> {
    // Normalize early to avoid drift
    const normalizedMessage = this.sanitizeDescription(message);

    const ctx = await this.detectContext(normalizedMessage);

    const intakeMeta: Partial<IntakeMetadata> = {
      mode: OperationalMode.ASSISTED,
      scope:
        ctx.role === "NGO_PARTNER" ? AccessScope.PARTNER : AccessScope.PUBLIC,
      intent: CaseType.REQUEST,
    };

    assertIntakeMetadata(intakeMeta);

    await this.performIntegrityGate(normalizedMessage, deviceId);

    return {
      mode: intakeMeta.mode,
      scope: intakeMeta.scope,
      intent: intakeMeta.intent,
      description: normalizedMessage,
      literacyLevel: ctx.literacyLevel,
    };
  }

  ////////////////////////////////////////////////////////////////
  // Context Detection (advisory only)
  ////////////////////////////////////////////////////////////////

  /**
   * Infers role + literacy heuristically.
   * Never trusted as authoritative identity.
   */
  public async detectContext(message: string): Promise<DetectedContext> {
    const msg = message.toLowerCase();

    let role: DetectedContext["role"] = "BENEFICIARY";

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

  ////////////////////////////////////////////////////////////////
  // Integrity Guard
  ////////////////////////////////////////////////////////////////

  /**
   * Blocks intake if HIGH severity anomaly detected.
   * Throws domain error code.
   */
  private async performIntegrityGate(
    message: string,
    deviceId: string,
  ): Promise<void> {
    const flags = await this.integrityService.performFullAudit(
      {
        beneficiaryId: "temp",
      } as any, // placeholder domain object for audit context
      message,
      deviceId,
    );

    if (flags.some((f) => f.severity === "HIGH")) {
      throw new Error("INTAKE_BLOCKED_HIGH_SEVERITY_ANOMALY");
    }
  }

  ////////////////////////////////////////////////////////////////
  // Utilities
  ////////////////////////////////////////////////////////////////

  /**
   * Ensures consistent formatting before persistence.
   */
  public sanitizeDescription(message: string): string {
    return message.trim().replace(/\s+/g, " ");
  }

  ////////////////////////////////////////////////////////////////
  // GhanaPost Resolver (External Boundary)
  ////////////////////////////////////////////////////////////////

  /**
   * Resolves GhanaPost digital address to coordinates.
   * Throws domain-safe error codes only.
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
      throw new Error("GHANAPOST_CONFIG_MISSING");
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
      throw new Error("GHANAPOST_NOT_FOUND");
    }

    const data: unknown = await res.json();

    if (typeof data !== "object" || data === null || !("Table" in data)) {
      throw new Error("GHANAPOST_NOT_FOUND");
    }

    const record = (data as any)?.Table?.[0];

    if (!record) {
      throw new Error("GHANAPOST_NOT_FOUND");
    }

    const lat = Number(record.Latitude);
    const lng = Number(record.Longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("GHANAPOST_NOT_FOUND");
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

////////////////////////////////////////////////////////////////
// Example usage (internal test)
// const service = new IntakeService(
//   new IntegrityService(),
//   new TaskService(),
// );
// await service.handleIntake(
//   "Support needed for school fees.",
//   "device-123",
// );

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// The service is strictly aligned to Prisma Case schema and avoids legacy PostWin coupling.
// IntakeResult is a transient object — controller owns persistence.
// Domain metadata is derived once and enforced via guard.
// Integrity enforcement is isolated from HTTP concerns for clean layering.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - IntakeMetadata: schema-aligned enums
// - IntakeResult: controller-facing return type
// - detectContext(): advisory inference
// - performIntegrityGate(): blocking guard
// - resolveGhanaPostAddress(): external boundary

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// - Controller must persist Case using returned mode/scope/intent.
// - Map domain errors (e.g. INTAKE_BLOCKED_HIGH_SEVERITY_ANOMALY) to HTTP.
// - Never persist literacyLevel unless explicitly added to schema.
// - Keep Case as single source of truth; avoid frontend entity leakage.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// This boundary cleanly separates intake processing from persistence.
// Future AI_AUGMENTED mode can be injected without modifying controller logic.
// Mapping Case → PostWin for frontend should live in a dedicated projection layer.
////////////////////////////////////////////////////////////////
