import express from "express";
import intakeRoutes from "./modules/intake/intake.routes";
import timelineRoutes from "./modules/timeline/timeline.route";

const app = express();

// Middleware
app.use(express.json({ limit: "1mb" }));

// Routes
app.use("/api/intake", intakeRoutes);
app.use("/api/timeline", timelineRoutes);

app.get("/health", (_req, res) => {
  res.json({
    status: "Posta Online",
    mode: process.env.NODE_ENV,
  });
});

export default app;
