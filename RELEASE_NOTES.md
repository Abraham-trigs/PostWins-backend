Posta Backend — Release Notes
v2.1.0 — Governance Hardening & Error Semantics

Release Date: 2026-02-21
Type: Minor (Backward-compatible contract refinement)

🎯 Overview

This release formalizes domain error semantics, strengthens lifecycle governance boundaries, and introduces orchestration and verification refinements.

The system continues to behave as a governed execution engine rather than a CRUD API.

✨ Added
Domain Error Framework

Introduced abstract DomainError base class

Added status and code metadata to domain-level errors

Refactored case and lifecycle errors to extend DomainError

Standardized global Express error mapping

New Modules

Orchestrator service

Verification initialization service

Verification request service

Decision orchestration service

Case tagging services

Message module (controller, routes, service)

Routing computation module

🔒 Governance Hardening

Lifecycle transitions strictly enforced through transitionCaseLifecycleWithLedger

Prisma middleware guard refined to detect unauthorized lifecycle writes

Internal lifecycle authorization marker introduced (symbol-based)

Deterministic ledger append behavior preserved

🧠 Behavioral Improvements
HTTP Error Semantics Standardized

Domain violations now return appropriate status codes:

Condition Before Now
Lifecycle invariant violation 500 409
Case not found 500 404
Forbidden access 500 403
Domain validation failure 500 4xx

This improves:

Retry safety

Client predictability

Observability clarity

Operational correctness

♻️ Refactoring

Removed legacy routing pathways

Removed reconciliation job

Consolidated ledger commit logic

Improved routing service structure

Updated security redaction policies

Improved execution completion invariants

🔬 Validation Performed

Lifecycle invariant enforcement

Deterministic intake behavior

Idempotent milestone completion

Verification consensus correctness

Execution invariant enforcement

Ledger UUID + sequence enforcement

Isolation across services

Integration tests passing

🚨 Breaking Changes

None.

All changes are backward-compatible at the transport contract level, with improved semantic precision in error responses.

📦 Compatibility

Frontend compatibility maintained.

Clients should handle:

409 for lifecycle conflicts

403 for authorization violations

404 for missing resources

Generic 500-based handling is no longer expected for domain violations.

🔭 Architectural State

System behavior reflects:

Deterministic lifecycle law

Ledger-first authority enforcement

Strict command boundary isolation

Domain-driven error semantics

Governance-aware orchestration

Summary

v2.1.0 elevates the backend from operational correctness to constitutional clarity.

This release stabilizes lifecycle governance, improves HTTP contract semantics, and strengthens orchestration boundaries without introducing breaking changes.
