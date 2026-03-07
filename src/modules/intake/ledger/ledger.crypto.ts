// apps/backend/src/modules/intake/ledger/ledger.crypto.ts
// Purpose: Deterministic canonical hashing for ledger commits.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
Ledger commitments must produce deterministic hashes regardless of
JSON key ordering. This file provides canonical serialization and
SHA256 hashing.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- canonicalize()
- generateHash()
*/

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import { createHash } from "crypto";

export function canonicalize(value: any): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();

  return `{${keys
    .map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]))
    .join(",")}}`;
}

export function generateHash(data: unknown): string {
  return createHash("sha256").update(canonicalize(data)).digest("hex");
}

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Used inside commit pipeline before signature creation.
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
Future ledger versions could swap SHA256 with SHA3 or BLAKE3
without modifying the service logic.
*/
