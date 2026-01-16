import { Request, Response, NextFunction } from "express";
/**
 * Section K: Idempotency Logic (durable)
 * - Accepts Idempotency-Key OR x-transaction-id (offline-first compatible)
 * - Persists idempotency records so restarts don't create duplicates
 * - Replays the original response on safe retries
 */
export declare const idempotencyGuard: (req: Request, res: Response, next: NextFunction) => Promise<void | Response<any, Record<string, any>>>;
/**
 * Controllers call this AFTER successful processing to store replayable response.
 */
export declare function commitIdempotencyResponse(res: Response, payload: unknown): Promise<void>;
//# sourceMappingURL=idempotency.middleware.d.ts.map