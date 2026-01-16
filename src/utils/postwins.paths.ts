import path from "node:path";

export const DATA_DIR = path.resolve(process.cwd(), "data");

export const LEDGER_FILE = path.join(DATA_DIR, "ledger.json");
export const IDEMPOTENCY_FILE = path.join(DATA_DIR, "idempotency.json");

// Timeline truth rules
export const FOLLOWUP_SCHEDULE_DAYS = [30, 90, 180] as const;
export const FOLLOWUP_WINDOW_DAYS = 14;
