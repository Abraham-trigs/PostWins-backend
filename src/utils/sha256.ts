import crypto from "node:crypto";

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return JSON.stringify(obj.map(stableStringify));

  const keys = Object.keys(obj as any).sort();
  const out: Record<string, any> = {};
  for (const k of keys) out[k] = (obj as any)[k];
  return JSON.stringify(out);
}
