// apps/backend/src/modules/intake/integrity/integrity.idempotency.store.ts
// Purpose: Persistent idempotency store

import fs from "fs";
import path from "path";
import { IdempotencyDb } from "./integrity.types";

export class IdempotencyStore {
  private dataDir = path.join(process.cwd(), "data");
  private idempotencyPath = path.join(this.dataDir, "idempotency.json");

  constructor() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (!fs.existsSync(this.idempotencyPath)) {
      const init: IdempotencyDb = { keys: {} };
      fs.writeFileSync(this.idempotencyPath, JSON.stringify(init, null, 2));
    }
  }

  load(): IdempotencyDb {
    try {
      const raw = fs.readFileSync(this.idempotencyPath, "utf8");
      const parsed = JSON.parse(raw);

      return {
        keys:
          typeof parsed?.keys === "object" && parsed?.keys ? parsed.keys : {},
      };
    } catch {
      return { keys: {} };
    }
  }

  save(db: IdempotencyDb) {
    try {
      fs.writeFileSync(this.idempotencyPath, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error("Idempotency store save failed:", e);
    }
  }
}
