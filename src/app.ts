// src/app.ts
// Purpose: Express bootstrap with request correlation, structured logging, and kill-switch compatible auth flow

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";

import cors from "cors";
import { randomUUID } from "crypto";
import cookieParser from "cookie-parser";
import "dotenv/config";

import intakeRoutes from "./modules/intake/intake.routes";
import timelineRoutes from "./modules/timeline/timeline.route";
import verificationRouter from "./modules/verification/verification.routes";
import verificationProvisionRoutes from "./modules/verification/verificationProvision.routes";
import { casesRouter } from "./modules/cases/cases.routes";
import decisionQueryRoutes from "./modules/decision/decision.query.routes";
import healthRoutes from "./modules/health/health.controller";
import executionRoutes from "./modules/execution/execution.routes";
import authRoutes from "./modules/auth/auth.routes";
import { evidenceRoutes } from "./modules/evidence";
import { getCurrentUser } from "./modules/auth/auth.controller";
import messageRoutes from "./modules/message/message.routes";

import { withRequestContext } from "@/lib/observability/request-context";
import { log } from "@/lib/observability/logger";
import { DomainError } from "@/lib/errors/domain-error";
import { authMiddleware } from "./middleware/auth.middleware";

const app: Express = express();

/**
 * Assumptions:  verificationRouter
 * - authMiddleware performs DB-backed session validation (kill-switch).
 * - JWT contains sessionId.
 * - Session revocation must be observable in logs.
 */

/**
 * Design reasoning:
 * - cookieParser must execute BEFORE authMiddleware.
 * - Request correlation must wrap entire lifecycle.
 * - Public routes must be mounted before auth guard.
 * - All /api protected routes pass through kill-switch validation.
 *
 * Structure:
 * 1. Core middleware
 * 2. CORS
 * 3. Correlation + logging
 * 4. Cache control
 * 5. Public routes
 * 6. Auth guard
 * 7. Protected routes
 * 8. Error handling
 *
 * Implementation guidance:
 * - Never mount protected routes above authMiddleware.
 * - Keep authRoutes public for login/refresh.
 * - Ensure infra logs revoked-session attempts.
 *
 * Scalability insight:
 * - Can insert Redis session caching before DB lookup.
 * - Can rate-limit auth routes.
 * - Can attach device/IP fingerprint middleware pre-auth.
 */

app.set("etag", false);

////////////////////////////////////////////////////////////////
// 1. Core middleware (Parsing & Cookies)
////////////////////////////////////////////////////////////////

app.use(express.json({ limit: "1mb" }));

// REQUIRED for kill-switch (authMiddleware reads cookies)
app.use(cookieParser());

////////////////////////////////////////////////////////////////
// 2. CORS
////////////////////////////////////////////////////////////////

const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Tenant-Id",
      "X-Request-Id",
    ],
  }),
);

////////////////////////////////////////////////////////////////
// 3. Correlation + structured logging (must wrap everything)
////////////////////////////////////////////////////////////////

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

  res.setHeader("x-request-id", requestId);

  const start = Date.now();

  void withRequestContext(async () => {
    log("INFO", "HTTP_REQUEST_STARTED", {
      method: req.method,
      path: req.originalUrl,
    });

    res.on("finish", () => {
      log("INFO", "HTTP_REQUEST_COMPLETED", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });

    next();
  }, requestId);
});

////////////////////////////////////////////////////////////////
// 4. Disable caching on API routes
////////////////////////////////////////////////////////////////

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

////////////////////////////////////////////////////////////////
// 5. Public Routes
////////////////////////////////////////////////////////////////

app.get("/__ping", (_req: Request, res: Response) => {
  res.status(200).send("pong");
});

// Auth must stay PUBLIC (login, verify, refresh)
app.use("/api/auth", authRoutes);

app.use("/api/health", healthRoutes);

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: "posta-backend",
    health: "/api/health",
  });
});

////////////////////////////////////////////////////////////////
// 6. Auth Guard (Kill-Switch Enforced)
////////////////////////////////////////////////////////////////

// Every route below this line requires:
// - Valid JWT
// - Valid DB session
// - Not revoked
// - Not expired

app.use("/api", authMiddleware);
app.get("/api/auth/me", getCurrentUser);

////////////////////////////////////////////////////////////////
// 7. Protected Domain Routes
////////////////////////////////////////////////////////////////

app.use("/api/intake", intakeRoutes);
app.use("/api/cases", casesRouter);
app.use("/api/timeline", timelineRoutes);
app.use("/api/verification", verificationRouter);
app.use("/api", verificationProvisionRoutes);
app.use("/api", decisionQueryRoutes);
app.use("/api/execution", executionRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/evidence", evidenceRoutes);

////////////////////////////////////////////////////////////////
// 8. Error Handling
////////////////////////////////////////////////////////////////

app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof DomainError) {
    return res.status(err.status).json({
      ok: false,
      error: err.message,
      code: err.code,
    });
  }

  const error = err as Error;

  log("ERROR", "HTTP_REQUEST_FAILED", {
    message: error?.message,
    stack: process.env.NODE_ENV === "production" ? undefined : error?.stack,
  });

  return res.status(500).json({
    ok: false,
    error: "Internal Server Error",
  });
});

export default app;
