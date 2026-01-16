import { Request, Response, NextFunction } from "express";
import { IntegrityService } from "../modules/intake/integrity.service";
import { sha256Hex, stableStringify } from "../utils/sha256";

/**
 * Section K: Idempotency Logic (durable)
 * - Accepts Idempotency-Key OR x-transaction-id (offline-first compatible)
 * - Persists idempotency records so restarts don't create duplicates
 * - Replays the original response on safe retries
 */
export const idempotencyGuard = async (req: Request, res: Response, next: NextFunction) => {
  const key =
    (req.header("Idempotency-Key")?.trim() ||
      (req.headers["x-transaction-id"] as string | undefined)?.trim()) ?? "";

  if (!key) {
    return res.status(400).json({
      ok: false,
      error: "Missing Idempotency-Key or x-transaction-id for offline-first sync",
    });
  }

  // Hash method + path + body (stable)
  const fingerprint = {
    method: req.method,
    path: req.path,
    body: req.body ?? null,
  };
  const requestHash = sha256Hex(stableStringify(fingerprint));

  const integrity = new IntegrityService();
  const existing = await integrity.get(key);

  if (existing) {
    // Same key used with different payload => conflict
    if (existing.requestHash !== requestHash) {
      return res.status(409).json({
        ok: false,
        error: "Idempotency key reused with different payload",
      });
    }

    // Exact replay
    return res.status(200).json(existing.response);
  }

  // Attach metadata for controller to commit later
  (res.locals as any).idempotency = { key, requestHash };
  return next();
};

/**
 * Controllers call this AFTER successful processing to store replayable response.
 */
export async function commitIdempotencyResponse(res: Response, payload: unknown) {
  const meta = (res.locals as any).idempotency as { key: string; requestHash: string } | undefined;
  if (!meta?.key || !meta?.requestHash) return;

  const integrity = new IntegrityService();
  await integrity.save(meta.key, meta.requestHash, payload);
}
