// apps/backend/src/constants/system.constants.ts
// Purpose: Centralized infrastructure-level system constants (scheduler locks, WS config, etc).

/* =========================================================
   Design reasoning
   - Prevents magic numbers from spreading across the codebase.
   - Infrastructure constants must live outside domain logic.
   - Enables safe reuse across multi-instance deployments.
========================================================= */

export const SYSTEM_CONSTANTS = {
  SCHEDULER_ADVISORY_LOCK_ID: 937421,
} as const;

/* =========================================================
   Structure
   - SYSTEM_CONSTANTS: immutable infra-level constants
========================================================= */

/* =========================================================
   Implementation guidance
   - Import into server.ts for advisory lock usage.
   - Future infra constants (heartbeat intervals, WS limits)
     should be added here.
========================================================= */

/* =========================================================
   Scalability insight
   Centralizing lock IDs prevents accidental reuse of the
   same advisory lock number across distributed services.
========================================================= */
