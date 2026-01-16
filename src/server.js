"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const mock_engine_1 = require("./modules/routing/structuring/mock-engine");
const intake_service_1 = require("./modules/intake/intake.service");
const postwin_routing_service_1 = require("./modules/routing/structuring/postwin-routing.service");
const verification_service_1 = require("./modules/verification/verification.service");
const integrity_service_1 = require("./modules/intake/integrity.service");
const ledger_service_1 = require("./modules/intake/ledger.service");
const task_service_1 = require("./modules/routing/structuring/task.service");
const journey_service_1 = require("./modules/routing/journey.service");
const PORT = Number(process.env.PORT) || 3001;
if (process.env.MODE === 'MOCK') {
    // 1. Initialize Shared Infrastructure
    const ledger = new ledger_service_1.LedgerService();
    const integrity = new integrity_service_1.IntegrityService();
    // 2. Initialize Core Services
    const tasks = new task_service_1.TaskService();
    const journey = new journey_service_1.JourneyService();
    const verifier = new verification_service_1.VerificationService(ledger);
    const router = new postwin_routing_service_1.PostWinRoutingService(tasks, journey, ledger);
    const intake = new intake_service_1.IntakeService(integrity, tasks);
    // 3. Inject into Mock Engine
    const mockEngine = new mock_engine_1.PostaMockEngine(intake, router, verifier);
    mockEngine.runSimulation().catch(err => {
        console.error("❌ Mock Simulation Failed:", err);
    });
}
app_1.default.listen(PORT, () => {
    console.log(`🚀 Posta Backend running on http://localhost:${PORT} in ${process.env.MODE || 'production'} mode`);
});
exports.default = app_1.default;
