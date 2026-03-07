// apps/backend/src/modules/intake/integrity/integrity.service.ts
// Purpose: Public integrity service facade coordinating fraud detection rules and persistence layers with trust-aware auditing

import { IntegrityFlag, PostWin } from "@posta/core";
import { performFullAudit } from "./integrity.audit";
import { RegistryStore } from "./integrity.registry.store";
import { BlacklistStore } from "./integrity.blacklist.store";
import { IdempotencyStore } from "./integrity.idempotency.store";

////////////////////////////////////////////////////////////////
// Integrity Service
////////////////////////////////////////////////////////////////

export class IntegrityService {
  //////////////////////////////////////////////////////////////////
  // Existing in-memory fraud tracking state
  //////////////////////////////////////////////////////////////////

  /**
   * Tracks hashes of processed messages to prevent duplicates.
   * NOTE:
   * In production this should live in Redis or a distributed cache
   * if multiple backend instances exist.
   */
  private processedHashes = new Set<string>();

  /**
   * Device registry mapping:
   * deviceId -> known device metadata (array allows expansion)
   */
  private deviceRegistry: Map<string, string[]>;

  /**
   * Last activity timestamp for rate-limit style checks
   */
  private lastActivity = new Map<string, number>();

  /**
   * Violation counter per device / identity
   */
  private violationCounters = new Map<string, number>();

  /**
   * Permanent blacklist
   */
  private blacklist: Set<string>;

  //////////////////////////////////////////////////////////////////
  // Beneficiary → Device tracking
  //////////////////////////////////////////////////////////////////

  /**
   * Tracks total device usage per beneficiary
   *
   * beneficiaryId -> Set<deviceId>
   *
   * Used to detect identity farming / shared device abuse
   */
  private beneficiaryDeviceMap = new Map<string, Set<string>>();

  //////////////////////////////////////////////////////////////////
  // Time-window tracking (device rotation detection)
  //////////////////////////////////////////////////////////////////

  /**
   * beneficiaryId -> device activity events
   *
   * Used to detect rapid device switching.
   */
  private beneficiaryActivity = new Map<
    string,
    Array<{ deviceId: string; timestamp: number }>
  >();

  //////////////////////////////////////////////////////////////////
  // Configuration
  //////////////////////////////////////////////////////////////////

  private readonly COOLDOWN_MS = 30000;
  private readonly MAX_VIOLATIONS = 5;

  private readonly MAX_DEVICES_PER_BENEFICIARY = 3;

  /**
   * Device rotation rule window
   */
  private readonly DEVICE_ROTATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Maximum devices within the window before flagging
   */
  private readonly DEVICE_ROTATION_THRESHOLD = 3;

  //////////////////////////////////////////////////////////////////
  // Persistence Stores
  //////////////////////////////////////////////////////////////////

  private registryStore = new RegistryStore();
  private blacklistStore = new BlacklistStore();
  private idempotencyStore = new IdempotencyStore();

  //////////////////////////////////////////////////////////////////
  // Constructor
  //////////////////////////////////////////////////////////////////

  constructor() {
    /**
     * Load persisted state.
     *
     * Device registry and blacklist are durable.
     * Runtime maps remain ephemeral.
     */
    this.deviceRegistry = this.registryStore.load();
    this.blacklist = this.blacklistStore.load();
  }

  //////////////////////////////////////////////////////////////////
  // Main Integrity Audit
  //////////////////////////////////////////////////////////////////

  /**
   * Performs full integrity audit for a PostWin narrative.
   *
   * @param postWin - PostWin data structure
   * @param rawMessage - original narrative text
   * @param deviceId - optional device identifier
   * @param isTrusted - indicates logged-in / verified author
   *
   * Trusted users skip certain anti-spam heuristics but
   * security rules still apply.
   */
  public async performFullAudit(
    postWin: PostWin,
    rawMessage: string,
    deviceId?: string,
    isTrusted = false,
  ): Promise<IntegrityFlag[]> {
    const flags: IntegrityFlag[] = [];
    const beneficiaryId = postWin.beneficiaryId;

    ////////////////////////////////////////////////////////////////
    // RULE 1
    // Beneficiary → Device tracking
    // (Skipped or relaxed for trusted users)
    ////////////////////////////////////////////////////////////////

    if (deviceId && beneficiaryId && !isTrusted) {
      let deviceSet = this.beneficiaryDeviceMap.get(beneficiaryId);

      if (!deviceSet) {
        deviceSet = new Set<string>();
        this.beneficiaryDeviceMap.set(beneficiaryId, deviceSet);
      }

      deviceSet.add(deviceId);

      /**
       * Flag if a beneficiary uses too many devices.
       * This does NOT block the request.
       */
      if (deviceSet.size > this.MAX_DEVICES_PER_BENEFICIARY) {
        flags.push({
          type: "IDENTITY_MISMATCH",
          severity: "LOW",
          timestamp: Date.now(),
        });
      }
    }

    ////////////////////////////////////////////////////////////////
    // RULE 2
    // Device rotation detection
    ////////////////////////////////////////////////////////////////

    if (deviceId && beneficiaryId && !isTrusted) {
      const now = Date.now();

      let activity = this.beneficiaryActivity.get(beneficiaryId) ?? [];

      activity.push({
        deviceId,
        timestamp: now,
      });

      /**
       * Remove events outside the time window.
       */
      activity = activity.filter(
        (entry) => now - entry.timestamp < this.DEVICE_ROTATION_WINDOW_MS,
      );

      this.beneficiaryActivity.set(beneficiaryId, activity);

      const uniqueDevices = new Set(activity.map((a) => a.deviceId));

      if (uniqueDevices.size > this.DEVICE_ROTATION_THRESHOLD) {
        flags.push({
          type: "SUSPICIOUS_TONE",
          severity: "LOW",
          timestamp: now,
        });
      }
    }

    ////////////////////////////////////////////////////////////////
    // Existing Integrity Audit Logic
    ////////////////////////////////////////////////////////////////

    /**
     * Delegates to core audit engine.
     *
     * The audit engine performs:
     *  - duplicate detection
     *  - blacklist checks
     *  - cooldown checks
     *  - rule-based fraud heuristics
     */

    const existingFlags = performFullAudit(
      {
        blacklist: this.blacklist,
        lastActivity: this.lastActivity,
        processedHashes: this.processedHashes,
        deviceRegistry: this.deviceRegistry,
        violationCounters: this.violationCounters,

        COOLDOWN_MS: this.COOLDOWN_MS,
        MAX_VIOLATIONS: this.MAX_VIOLATIONS,

        /**
         * NEW: trust context
         * Enables relaxed rules for authenticated actors
         */
        isTrusted,

        saveRegistry: () => this.registryStore.save(this.deviceRegistry),
        saveBlacklist: () => this.blacklistStore.save(this.blacklist),
      },
      postWin,
      rawMessage,
      deviceId,
    );

    return [...flags, ...existingFlags];
  }

  //////////////////////////////////////////////////////////////////
  // Idempotency Store API
  //////////////////////////////////////////////////////////////////

  /**
   * Retrieves an idempotent response record
   */
  public async get(
    key: string,
  ): Promise<{ requestHash: string; response: unknown } | null> {
    const db = this.idempotencyStore.load();
    const record = db.keys[key];

    if (!record) return null;

    return {
      requestHash: record.requestHash,
      response: record.response,
    };
  }

  /**
   * Saves idempotent response
   */
  public async save(
    key: string,
    requestHash: string,
    response: unknown,
  ): Promise<void> {
    const db = this.idempotencyStore.load();

    db.keys[key] = {
      requestHash,
      response,
      recordedAt: new Date().toISOString(),
    };

    this.idempotencyStore.save(db);
  }
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////

/**
 * This service acts as a coordination layer between:
 *
 * - fraud detection logic (integrity.audit.ts)
 * - persistence layers (registry + blacklist stores)
 * - runtime fraud heuristics (device rotation, device count)
 *
 * Introducing `isTrusted` allows the system to treat
 * authenticated users differently from anonymous users
 * without weakening core security protections.
 *
 * Security-critical checks remain active for both paths.
 */

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////

/**
 * IntegrityService
 *
 * performFullAudit() → orchestrates all fraud rules
 * get()              → idempotency retrieval
 * save()             → idempotency persistence
 */

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////

/**
 * Controller usage example:
 *
 * const flags = await integrityService.performFullAudit(
 *   postWin,
 *   narrative,
 *   deviceId,
 *   isTrusted
 * );
 *
 * Governance layer decides:
 *
 * if flags contain HIGH severity → block or verify
 * if LOW severity → allow but monitor
 */

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////

/**
 * The following structures should migrate to Redis for
 * horizontally scaled deployments:
 *
 * - processedHashes
 * - beneficiaryActivity
 * - beneficiaryDeviceMap
 *
 * Doing so ensures fraud detection works consistently
 * across multiple API instances.
 */

////////////////////////////////////////////////////////////////
// Example usage (test snippet)
////////////////////////////////////////////////////////////////

/**
 * const integrityService = new IntegrityService();
 *
 * const flags = await integrityService.performFullAudit(
 *   { beneficiaryId: "user_123" } as PostWin,
 *   "My community needs clean water access",
 *   "device_abc",
 *   false
 * );
 *
 * console.log(flags);
 */
