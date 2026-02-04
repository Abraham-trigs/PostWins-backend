// apps/backend/src/utils/uuid.ts
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error(`${name} must be a UUID. Got: ${String(value)}`);
  }
}
