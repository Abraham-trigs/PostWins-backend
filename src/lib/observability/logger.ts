import { getRequestId } from "./request-context";

type LogLevel = "INFO" | "WARN" | "ERROR";

export function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
) {
  const entry = {
    level,
    message,
    ts: Date.now(),
    requestId: getRequestId() ?? null,
    ...meta,
  };

  // JSON-only output (log aggregation safe)
  console.log(JSON.stringify(entry));
}
