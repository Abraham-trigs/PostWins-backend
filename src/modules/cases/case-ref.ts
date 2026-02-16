// apps/backend/src/modules/cases/case-ref.ts
// Purpose: Canonical reference contract for case-linked entities with runtime-safe constructors.

////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////

export type CaseRef =
  | { kind: "CASE"; id: string }
  | { kind: "DECISION"; id: string }
  | { kind: "POLICY"; policyKey: string }
  | { kind: "LEDGER"; id: string }
  | { kind: "TAG"; value: string };

////////////////////////////////////////////////////////////////
// Constructors (prevent ad-hoc object creation)
////////////////////////////////////////////////////////////////

export function caseRef(id: string): CaseRef {
  assertNonEmpty(id, "CASE id");
  return { kind: "CASE", id };
}

export function decisionRef(id: string): CaseRef {
  assertNonEmpty(id, "DECISION id");
  return { kind: "DECISION", id };
}

export function policyRef(policyKey: string): CaseRef {
  assertNonEmpty(policyKey, "POLICY key");
  return { kind: "POLICY", policyKey };
}

export function ledgerRef(id: string): CaseRef {
  assertNonEmpty(id, "LEDGER id");
  return { kind: "LEDGER", id };
}

export function tagRef(value: string): CaseRef {
  assertNonEmpty(value, "TAG value");
  return { kind: "TAG", value };
}

////////////////////////////////////////////////////////////////
// Type Guards
////////////////////////////////////////////////////////////////

export function isCaseRef(ref: CaseRef): ref is { kind: "CASE"; id: string } {
  return ref.kind === "CASE";
}

export function isDecisionRef(
  ref: CaseRef,
): ref is { kind: "DECISION"; id: string } {
  return ref.kind === "DECISION";
}

export function isPolicyRef(
  ref: CaseRef,
): ref is { kind: "POLICY"; policyKey: string } {
  return ref.kind === "POLICY";
}

export function isLedgerRef(
  ref: CaseRef,
): ref is { kind: "LEDGER"; id: string } {
  return ref.kind === "LEDGER";
}

export function isTagRef(ref: CaseRef): ref is { kind: "TAG"; value: string } {
  return ref.kind === "TAG";
}

////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////

function assertNonEmpty(value: string, label: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
}

////////////////////////////////////////////////////////////////
// Example Usage
////////////////////////////////////////////////////////////////

/*
const ref = caseRef("a3b8f3b6-uuid");

if (isCaseRef(ref)) {
  console.log(ref.id);
}
*/

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// CaseRef is a discriminated union that allows referencing different domain
// entities in a type-safe way. Constructors prevent ad-hoc object creation,
// eliminating malformed references from leaking into ledger payloads or
// decision logic.

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
// - Discriminated union for compile-time safety
// - Explicit constructors for runtime validation
// - Type guards for safe narrowing
// - Local helper for minimal validation

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
// Always use provided constructor helpers instead of manually constructing
// CaseRef objects. This ensures future structural changes propagate safely
// without silent breakage.

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
// If additional reference kinds are introduced (e.g., GRANT, TRANCHE),
// extend the union and provide a constructor + guard. Avoid embedding
// business logic here. This file defines identity boundaries only.
