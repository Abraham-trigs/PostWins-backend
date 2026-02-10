import { LedgerEventType } from "@prisma/client";
import { CaseLifecycle } from "./CaseLifecycle";

/**
 * Maps lifecycle transitions to ledger events.
 *
 * This encodes INTENT, not mechanics.
 */
export const CASE_LIFECYCLE_LEDGER_EVENTS: Record<
  CaseLifecycle,
  LedgerEventType
> = {
  INTAKE: LedgerEventType.CASE_CREATED,
  ROUTED: LedgerEventType.ROUTED,
  VERIFIED: LedgerEventType.VERIFIED,
  FLAGGED: LedgerEventType.CASE_FLAGGED,
  HUMAN_REVIEW: LedgerEventType.CASE_UPDATED,
};
