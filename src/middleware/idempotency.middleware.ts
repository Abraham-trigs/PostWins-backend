import { Request, Response, NextFunction } from "express";
import { IntegrityService } from "../modules/intake/integrity.service";
import { sha256Hex, stableStringify } from "../utils/sha256";

type StoredIdempotencyRecord = {
  requestHash: string;
  status: number;
  response: unknown;
};

type IdempotencyMeta = {
  key: string;
  requestHash: string;
};

const integrity = new IntegrityService();

function requiresIdempotency(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

/**
 * Section K: Idempotency Logic (durable)
 * - Accepts Idempotency-Key OR x-transaction-id (offline-first compatible)
 * - Persists idempotency records so restarts don't create duplicates
 * - Replays the original response on safe retries
 */
export const idempotencyGuard = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!requiresIdempotency(req.method)) return next();

  const key =
    (req.header("Idempotency-Key")?.trim() ||
      (req.headers["x-transaction-id"] as string | undefined)?.trim()) ??
    "";

  if (!key) {
    return res.status(400).json({
      ok: false,
      error:
        "Missing Idempotency-Key or x-transaction-id for offline-first sync",
    });
  }

  // Hash method + url + body (stable)
  const fingerprint = {
    method: req.method,
    url: req.originalUrl, // includes mount path + query
    body: req.body ?? null,
  };
  const requestHash = sha256Hex(stableStringify(fingerprint));

  const existing = (await integrity.get(key)) as StoredIdempotencyRecord | null;

  if (existing) {
    // Same key used with different payload => conflict
    if (existing.requestHash !== requestHash) {
      return res.status(409).json({
        ok: false,
        error: "Idempotency key reused with different payload",
      });
    }

    // Exact replay (preserve original status)
    return res.status(existing.status ?? 200).json(existing.response);
  }

  // Attach metadata for controller to commit later
  (res.locals as any).idempotency = {
    key,
    requestHash,
  } satisfies IdempotencyMeta;
  return next();
};

/**
 * Controllers call this AFTER successful processing to store replayable response.
 * Store the status too, so replays match the original response exactly.
 */
export async function commitIdempotencyResponse(
  res: Response,
  payload: unknown,
  status: number = res.statusCode || 200,
) {
  const meta = (res.locals as any).idempotency as IdempotencyMeta | undefined;
  if (!meta?.key || !meta?.requestHash) return;

  await integrity.save(meta.key, meta.requestHash, {
    requestHash: meta.requestHash,
    status,
    response: payload,
  } satisfies StoredIdempotencyRecord);
}
