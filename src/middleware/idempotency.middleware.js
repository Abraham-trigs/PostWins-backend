"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyGuard = void 0;
exports.commitIdempotencyResponse = commitIdempotencyResponse;
const integrity_service_1 = require("../modules/intake/integrity.service");
const sha256_1 = require("../utils/sha256");
/**
 * Section K: Idempotency Logic (durable)
 * - Accepts Idempotency-Key OR x-transaction-id (offline-first compatible)
 * - Persists idempotency records so restarts don't create duplicates
 * - Replays the original response on safe retries
 */
const idempotencyGuard = async (req, res, next) => {
    const key = (req.header("Idempotency-Key")?.trim() ||
        req.headers["x-transaction-id"]?.trim()) ?? "";
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
    const requestHash = (0, sha256_1.sha256Hex)((0, sha256_1.stableStringify)(fingerprint));
    const integrity = new integrity_service_1.IntegrityService();
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
    res.locals.idempotency = { key, requestHash };
    return next();
};
exports.idempotencyGuard = idempotencyGuard;
/**
 * Controllers call this AFTER successful processing to store replayable response.
 */
async function commitIdempotencyResponse(res, payload) {
    const meta = res.locals.idempotency;
    if (!meta?.key || !meta?.requestHash)
        return;
    const integrity = new integrity_service_1.IntegrityService();
    await integrity.save(meta.key, meta.requestHash, payload);
}
