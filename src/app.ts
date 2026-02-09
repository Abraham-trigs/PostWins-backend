import express, { type Express } from "express";
import intakeRoutes from "./modules/intake/intake.routes";
import timelineRoutes from "./modules/timeline/timeline.route";
import verificationRouter from "./modules/verification/verification.routes";
import { casesRouter } from "./modules/cases/cases.routes";
import decisionQueryRoutes from "./modules/decision/decision.query.routes";

const app: Express = express();

// Middleware
app.use(express.json({ limit: "1mb" }));

// Debug ping
app.get("/__ping", (_req, res) => {
  res.status(200).send("pong");
});

// Root route
app.get("/", (_req, res) => {
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

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "Posta Online",
    mode: process.env.NODE_ENV ?? "unknown",
  });
});

// Routes
app.use("/api/intake", intakeRoutes);
app.use("/api/cases", casesRouter);
app.use("/api/timeline", timelineRoutes);
app.use("/api/verification", verificationRouter);
app.use("/api", decisionQueryRoutes);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

export default app;
