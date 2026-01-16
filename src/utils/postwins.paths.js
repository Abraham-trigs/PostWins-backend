"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOLLOWUP_WINDOW_DAYS = exports.FOLLOWUP_SCHEDULE_DAYS = exports.IDEMPOTENCY_FILE = exports.LEDGER_FILE = exports.DATA_DIR = void 0;
const node_path_1 = __importDefault(require("node:path"));
exports.DATA_DIR = node_path_1.default.resolve(process.cwd(), "data");
exports.LEDGER_FILE = node_path_1.default.join(exports.DATA_DIR, "ledger.json");
exports.IDEMPOTENCY_FILE = node_path_1.default.join(exports.DATA_DIR, "idempotency.json");
// Timeline truth rules
exports.FOLLOWUP_SCHEDULE_DAYS = [30, 90, 180];
exports.FOLLOWUP_WINDOW_DAYS = 14;
