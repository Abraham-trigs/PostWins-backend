// src/app.ts — Express application bootstrap with request correlation and structured logging

import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomUUID } from "crypto";

import intakeRoutes from "./modules/intake/intake.routes";
import timelineRoutes from "./modules/timeline/timeline.route";
import verificationRouter from "./modules/verification/verification.routes";
import { casesRouter } from "./modules/cases/cases.routes";
import decisionQueryRoutes from "./modules/decision/decision.query.routes";

import { withRequestContext } from "@/lib/observability/request-context";
import { log } from "@/lib/observability/logger";

const app: Express = express();

////////////////////////////////////////////////////////////////
// Core middleware
////////////////////////////////////////////////////////////////

app.use(express.json({ limit: "1mb" }));

////////////////////////////////////////////////////////////////
// Correlation + structured logging middleware
////////////////////////////////////////////////////////////////

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

  res.setHeader("x-request-id", requestId);

  const start = Date.now();

  // IMPORTANT: synchronous context boundary
  withRequestContext(() => {
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
    health: "/health",
    routes: [
      "/api/intake",
      "/api/cases",
      "/api/verification",
      "/api/timeline",
      "/api/cases/:id/decisions",
    ],
  });
});

////////////////////////////////////////////////////////////////
// Health check
////////////////////////////////////////////////////////////////

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "Posta Online",
    mode: process.env.NODE_ENV ?? "unknown",
  });
});

////////////////////////////////////////////////////////////////
// Domain routes
////////////////////////////////////////////////////////////////

app.use("/api/intake", intakeRoutes);
app.use("/api/cases", casesRouter);
app.use("/api/timeline", timelineRoutes);
app.use("/api/verification", verificationRouter);
app.use("/api", decisionQueryRoutes);

////////////////////////////////////////////////////////////////
// 404 fallback
////////////////////////////////////////////////////////////////

app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

////////////////////////////////////////////////////////////////
// Global error handler (must be last)
////////////////////////////////////////////////////////////////

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  log("ERROR", "HTTP_REQUEST_FAILED", {
    message: err?.message,
    stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
  });

  res.status(500).json({
    ok: false,
    error: "Internal Server Error",
  });
});

export default app;
