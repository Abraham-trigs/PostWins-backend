// apps/backend/src/modules/intake/integrity/integrity.blacklist.store.ts
// Purpose: Blacklist persistence

import fs from "fs";
import path from "path";

export class BlacklistStore {
  blacklistPath = path.join(process.cwd(), "blacklist.json");

  load(): Set<string> {
    try {
      if (fs.existsSync(this.blacklistPath)) {
        const data = JSON.parse(fs.readFileSync(this.blacklistPath, "utf8"));
        return new Set(data);
      }
    } catch {}

    return new Set();
  }

  save(set: Set<string>) {
    try {
      const data = JSON.stringify(Array.from(set), null, 2);
      fs.writeFileSync(this.blacklistPath, data);
    } catch (e) {
      console.error("Blacklist save failed:", e);
    }
  }
}
