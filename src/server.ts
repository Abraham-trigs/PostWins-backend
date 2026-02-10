import app from "./app";
import { PostaMockEngine } from "./modules/routing/structuring/mock-engine";
import { IntakeService } from "./modules/intake/intake.service";
import { PostWinRoutingService } from "./modules/routing/structuring/postwin-routing.service";
import { VerificationService } from "./modules/verification/verification.service";
import { IntegrityService } from "./modules/intake/intergrity/integrity.service";
import { LedgerService } from "./modules/intake/ledger.service";
import { TaskService } from "./modules/routing/structuring/task.service";
import { JourneyService } from "./modules/routing/journey/journey.service";

const PORT = Number(process.env.PORT) || 3001;
const MODE = process.env.MODE || "production";

if (MODE === "MOCK") {
  // Shared infrastructure
  const ledger = new LedgerService();
  const integrity = new IntegrityService();

  // Core services
  const tasks = new TaskService();
  const journey = new JourneyService();
  const verifier = new VerificationService(ledger);
  const router = new PostWinRoutingService(tasks, journey, ledger);
  const intake = new IntakeService(integrity, tasks);

  // Simulation runner
  const mockEngine = new PostaMockEngine(intake, router, verifier);
  mockEngine.runSimulation().catch((err) => {
    console.error("❌ Mock Simulation Failed:", err);
  });
}

const server = app.listen(PORT, () => {
  console.log(
    `🚀 Posta Backend running on http://localhost:${PORT} in ${MODE} mode`,
  );
});

// Graceful shutdown (future-proofing)
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

export default app;
