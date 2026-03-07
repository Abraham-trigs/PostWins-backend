// apps/backend/src/modules/intake/ledger/ledger.keys.ts
// Purpose: RSA key management for ledger signing.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
Ledger commits must be cryptographically signed. Key generation
and loading is separated to isolate filesystem access from
ledger logic.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- loadLedgerKeys()
*/

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

import { generateKeyPairSync } from "crypto";
import fs from "fs";
import path from "path";

export function loadLedgerKeys() {
  const dataDir = path.join(process.cwd(), "data");
  const keysDir = path.join(dataDir, "keys");

  const privateKeyPath = path.join(keysDir, "private.pem");
  const publicKeyPath = path.join(keysDir, "public.pem");

  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    return {
      privateKey: fs.readFileSync(privateKeyPath, "utf8"),
      publicKey: fs.readFileSync(publicKeyPath, "utf8"),
    };
  }

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const privatePem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;

  const publicPem = publicKey.export({
    type: "spki",
    format: "pem",
  }) as string;

  fs.writeFileSync(privateKeyPath, privatePem);
  fs.writeFileSync(publicKeyPath, publicPem);

  return {
    privateKey: privatePem,
    publicKey: publicPem,
  };
}

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Called once during LedgerService construction.
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
In production environments, keys should move to KMS
(AWS KMS / Hashicorp Vault) instead of local disk.
*/
