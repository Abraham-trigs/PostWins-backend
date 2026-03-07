// apps/backend/src/modules/intake/integrity/integrity.registry.store.ts
// Purpose: Device → beneficiary registry persistence

import fs from "fs";
import path from "path";

export class RegistryStore {
  registryPath = path.join(process.cwd(), "device_registry.json");

  load(): Map<string, string[]> {
    try {
      if (fs.existsSync(this.registryPath)) {
        const data = JSON.parse(fs.readFileSync(this.registryPath, "utf8"));
        return new Map(Object.entries(data));
      }
    } catch {}

    return new Map();
  }

  save(map: Map<string, string[]>) {
    try {
      const data = JSON.stringify(Object.fromEntries(map), null, 2);
      fs.writeFileSync(this.registryPath, data);
    } catch (e) {
      console.error("Registry save failed:", e);
    }
  }
}

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// Registry persistence isolated to prevent service bloat.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// RegistryStore.load()
// RegistryStore.save()

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// Can migrate to Redis later without touching audit logic.
