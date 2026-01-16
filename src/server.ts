import app from './app';
import { PostaMockEngine } from './modules/routing/structuring/mock-engine';
import { IntakeService } from './modules/intake/intake.service';
import { PostWinRoutingService } from './modules/routing/structuring/postwin-routing.service';
import { VerificationService } from './modules/verification/verification.service';
import { IntegrityService } from './modules/intake/integrity.service';
import { LedgerService } from './modules/intake/ledger.service';
import { TaskService } from './modules/routing/structuring/task.service';
import { JourneyService } from './modules/routing/journey.service';

const PORT: number = Number(process.env.PORT) || 3001;

if (process.env.MODE === 'MOCK') {
  // 1. Initialize Shared Infrastructure
  const ledger = new LedgerService();
  const integrity = new IntegrityService();
  
  // 2. Initialize Core Services
  const tasks = new TaskService();
  const journey = new JourneyService();
  const verifier = new VerificationService(ledger);
const router = new PostWinRoutingService(tasks, journey, ledger);   const intake = new IntakeService(integrity, tasks);

  // 3. Inject into Mock Engine
  const mockEngine = new PostaMockEngine(intake, router, verifier);
  
  mockEngine.runSimulation().catch(err => {
    console.error("❌ Mock Simulation Failed:", err);
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Posta Backend running on http://localhost:${PORT} in ${process.env.MODE || 'production'} mode`);
});

export default app;
