export const ExecutionProgressLabel = {
  STARTED: "STARTED",
  CHECKPOINT: "CHECKPOINT",
  EVIDENCE_ATTACHED: "EVIDENCE_ATTACHED",
  BLOCKED: "BLOCKED",
  RESUMED: "RESUMED",
  NOTE: "NOTE",
} as const;

export type ExecutionProgressLabel =
  (typeof ExecutionProgressLabel)[keyof typeof ExecutionProgressLabel];
