// src/app.ts — Express application bootstrap with request correlation and structured logging

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";

import cors from "cors";
import { randomUUID } from "crypto";

import intakeRoutes from "./modules/intake/intake.routes";
import timelineRoutes from "./modules/timeline/timeline.route";
import verificationRouter from "./modules/verification/verification.routes";
import { casesRouter } from "./modules/cases/cases.routes";
import decisionQueryRoutes from "./modules/decision/decision.query.routes";
import healthRoutes from "./modules/health/health.controller";
import executionRoutes from "./modules/execution/execution.routes";

import { withRequestContext } from "@/lib/observability/request-context";
import { log } from "@/lib/observability/logger";
import { DomainError } from "@/lib/errors/domain-error";

const app: Express = express();

// Disable ETag to prevent unintended 304 caching on dynamic tenant data
app.set("etag", false);

////////////////////////////////////////////////////////////////
// Core middleware
////////////////////////////////////////////////////////////////

app.use(express.json({ limit: "1mb" }));

////////////////////////////////////////////////////////////////
// CORS (must be before routes)
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

// Prevent caching on API routes
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

////////////////////////////////////////////////////////////////
// Correlation + structured logging middleware
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
// Debug ping
////////////////////////////////////////////////////////////////

app.get("/__ping", (_req: Request, res: Response) => {
  res.status(200).send("pong");
});

////////////////////////////////////////////////////////////////
// Root route
////////////////////////////////////////////////////////////////

app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: "posta-backend",
    health: "/api/health",
    routes: [
      "/api/intake",
      "/api/cases",
      "/api/verification",
      "/api/timeline",
      "/api/cases/:id/decisions",
      "/api/health",
      "/api/health/ledger",
    ],
  });
});

////////////////////////////////////////////////////////////////
// Domain routes
////////////////////////////////////////////////////////////////

app.use("/api", healthRoutes);
app.use("/api/intake", intakeRoutes);
app.use("/api/cases", casesRouter);
app.use("/api/timeline", timelineRoutes);
app.use("/api/verification", verificationRouter);
app.use("/api", decisionQueryRoutes);
app.use("/api/execution", executionRoutes);

////////////////////////////////////////////////////////////////
// 404 fallback
////////////////////////////////////////////////////////////////

app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

////////////////////////////////////////////////////////////////
// Global error handler (must be last)
////////////////////////////////////////////////////////////////

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
