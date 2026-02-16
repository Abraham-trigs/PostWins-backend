// apps/backend/src/modules/cases/CaseLifecycle.ts
// Purpose: Canonical CaseLifecycle type derived from Prisma schema.
// This file prevents shadow enum drift while preserving domain-level imports.

import { CaseLifecycle as PrismaCaseLifecycle } from "@prisma/client";

////////////////////////////////////////////////////////////////
// Canonical Re-export
////////////////////////////////////////////////////////////////

/**
 * ⚠️ LIFECYCLE LAW
 * --------------------------------------------------
 * CaseLifecycle is AUTHORITATIVE STATE.
 *
 * ❌ Do NOT redefine this enum locally.
 * ❌ Do NOT infer lifecycle from routing, verification, or tasks.
 *
 * ✅ All lifecycle changes MUST go through:
 * transitionCaseLifecycleWithLedger
 *
 * This type is derived directly from Prisma schema.
 */
export const CaseLifecycle = PrismaCaseLifecycle;

export type CaseLifecycle = PrismaCaseLifecycle;

// ////////////////////////////////////////////////////////////////
// // Example Usage
// ////////////////////////////////////////////////////////////////

// /*
// import { CaseLifecycle } from "@/modules/cases/CaseLifecycle";

// if (case.lifecycle === CaseLifecycle.ROUTED) {
//   // safe
// }
// */

// ////////////////////////////////////////////////////////////////
// // Design reasoning
// ////////////////////////////////////////////////////////////////
// Enums must originate from schema. Local enum definitions create
// runtime/schema drift and break deterministic replay guarantees.
// This file preserves import ergonomics without redefinition.

// ////////////////////////////////////////////////////////////////
// // Structure
// ////////////////////////////////////////////////////////////////
// - Re-export Prisma enum as value
// - Re-export Prisma enum as type
// - No duplication
// - No literal strings

// ////////////////////////////////////////////////////////////////
// // Implementation guidance
// ////////////////////////////////////////////////////////////////
// Search entire backend for:
// `enum CaseLifecycle`
// Delete any local enum definitions.

// All lifecycle comparisons must use:
// CaseLifecycle.ROUTED
// CaseLifecycle.VERIFIED
// etc.

// ////////////////////////////////////////////////////////////////
// // Scalability insight
// ////////////////////////////////////////////////////////////////
// Future lifecycle additions require only Prisma schema updates.
// No shadow enums means zero drift risk across services.
