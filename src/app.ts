import express, { type Express } from "express";
import intakeRoutes from "./modules/intake/intake.routes";
import timelineRoutes from "./modules/timeline/timeline.route";
import verificationRouter from "./modules/verification/verification.routes";

const app: Express = express();

// Middleware
app.use(express.json({ limit: "1mb" }));

// Root route (so "/" does not return "Cannot GET /")
app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "posta-backend",
    health: "/health",
    routes: ["/api/intake", "/api/verification", "/api/timeline"],
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
app.use("/api/timeline", timelineRoutes);
app.use("/api/verification", verificationRouter);

// 404 fallback (helps debugging)
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

export default app;
