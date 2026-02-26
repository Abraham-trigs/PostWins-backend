Cases Module

Ledger-authoritative case lifecycle governance, reference resolution, explainability projection, and reconciliation infrastructure.

This module does not “manage cases.”

It governs state authority.

If this module is wrong, your entire system becomes a collection of opinions instead of facts.

Core Principle

The ledger is sovereign.
The database lifecycle is a projection.
All transitions must be explainable.

Everything in this module flows from that axiom.

Domain Responsibilities

This module owns:

Canonical lifecycle transitions

Ledger-bound lifecycle mutation

Appeal lifecycle authority

Case reference resolution

Explainability payload assembly

Lifecycle projection from ledger replay

Drift detection and repair

Tag attachment governance

Capability derivation (UI advisory)

Cursor-based case listing

Orchestrator-bound effect execution

It does not:

Store raw ledger mechanics (LedgerService does)

Define policy evaluation logic

Implement RBAC enforcement

Own identity authentication

Lifecycle Sovereignty
Authoritative State

CaseLifecycle is derived directly from Prisma.

It must never be shadowed.

Local enums are forbidden.

All lifecycle changes must go through:

transitionCaseLifecycleWithLedger

No direct case.update({ lifecycle }) is permitted.

Closed Transition Law

Defined in:

caseLifecycle.transitions.ts

caseLifecycle.events.ts

If a transition is not declared, it does not exist.

Terminal states explicitly map to [].

Compiler exhaustiveness protects against enum drift.

This prevents:

Silent lifecycle mutations

Ad-hoc transitions

Governance ambiguity

Ledger-Bound Transition

transitionCaseLifecycleWithLedger

Guarantees:

Input validation via Zod

ActorKind enforcement (HUMAN requires userId)

Concurrency protection via conditional update

Ledger append in same transaction

Authority envelope generation

Intent context capture

Structured audit logging

Lifecycle write is atomic with ledger append.

If ledger fails, lifecycle does not change.

This preserves replay determinism.

Ledger Replay as Truth

deriveLifecycleFromLedger

Pure function.

No DB access.

Input must be ordered events.

Replays literal history, not inference.

If projection and replay differ → drift exists.

Drift is repairable. Ledger is not.

Reconciliation Infrastructure
Why Reconciliation Exists

Distributed systems drift.

Projections lag.
Hotfixes bypass authority.
Concurrent writes misfire.

So we sweep.

Components

LifecycleReconciliationService

TenantLifecycleReconciliationJob

LifecycleReconciliationScheduler

reconcileTenantLifecycle (admin endpoint)

Guarantees

Per-case replay

Drift detection

Atomic repair

Repair logged as LIFECYCLE_REPAIRED

Idempotent execution

Sequential per-tenant processing

Scheduler:

Postgres advisory lock

Single-leader execution

Multi-instance safe

Drift detection only (no uncontrolled mutation)

This is operational governance built into the codebase.

Appeal Lifecycle Authority

AppealLifecycleAuthorityService

Appeals are not UI toggles.

They are lifecycle mutations bound to authority.

Opening Appeal

Allowed only from:

VERIFIED → HUMAN_REVIEW

Transaction includes:

Lifecycle validation

Appeal creation

Ledger append (APPEAL_OPENED)

Lifecycle transition

Resolving Appeal

Allowed only from:

HUMAN_REVIEW

Flow:

Validate appeal still OPEN

Determine latest authoritative VERIFIED commit

Mark appeal resolved

Append ledger event with supersession link

Transition lifecycle to VERIFIED or FLAGGED

AuthorityProof is mandatory.

Appeals mutate state only through ledger-bound transitions.

Case Reference System (CaseRef)

A Case is not always referenced directly.

You may reference:

CASE

DECISION

POLICY

LEDGER

TAG

Resolution always:

Enforces tenant boundary

Rejects superseded decisions

Rejects superseded ledger commits

Validates global tag joins

Returns authoritative caseId only

Controllers must never trust raw IDs.

Always resolve first.

This prevents:

Stale governance references

Cross-tenant leakage

Superseded decision misuse

Explainability Engine
Flow

Controller
→ Normalize CaseRef
→ Resolve authoritative caseId
→ Load explainable payload
→ Redact based on viewer
→ Map to transport contract

Separation of Concerns

Loader:

Fetches full domain payload

Includes tags, beneficiary, audit trail, timeline, ledger, policies

Mapper:

Pure projection

No lifecycle mutation

JSON boundary normalization

Date → ISO conversion

Ledger sorting

Disbursement domain explanation + redaction

Redaction:

Role-aware

No data mutation

Output-only transformation

Explain endpoint is read-only and deterministic.

Capability Derivation

deriveCaseCapabilities

Advisory only.

Must not encode business rules.

Depends strictly on:

Lifecycle

Execution status

Verification status

Output is UI guidance.

Never use capability output to enforce backend authority.

Case Listing

cases.controller.ts

Properties:

Tenant derived strictly from JWT

Stable composite ordering (createdAt DESC, id DESC)

Cursor-based pagination

limit + 1 technique

Explicit DTO mapping

ISO serialization at boundary

Required index:

@@index([tenantId, createdAt, id])

Without it, pagination collapses under large tenants.

Tag System

Two layers:

Global Tag registry (platform vocabulary)

CaseTag join (tenant-scoped association)

Attach:

Idempotent

Validates case ownership

Validates global tag existence

Detach:

Transactional

Safe under concurrency

Global tags are platform-owned.
Case associations are tenant-bound.

Orchestrator Integration

OrchestratorService

Executes DecisionEffects.

Example:

EXECUTION_VERIFIED effect:

Validates:

Case in EXECUTING

Execution completed

Verification consensus reached

Then transitions lifecycle to VERIFIED via ledger-bound transition.

Orchestrator never mutates lifecycle directly.

It delegates to lifecycle authority.

Drift Repair Philosophy

Projection is mutable.
Ledger is immutable.
Repair writes new ledger entry.
Never delete history.
Never rewrite past.

This ensures:

Audit continuity

Replay determinism

Regulatory defensibility

Invariants (Non-Negotiable)

Lifecycle is ledger-bound.

Ledger is append-only.

Superseded decisions cannot resolve references.

CaseRef resolution must enforce tenant boundary.

Drift must be repairable.

Transitions must be explicit.

Projection must never infer beyond ledger.

Break these and the system becomes non-deterministic.

Failure Modes Considered

Concurrent lifecycle writes
→ Conditional update detects modification

Ledger append failure
→ Transaction rollback

Superseded decision resolution
→ Resolver rejects

Tag cross-tenant leakage
→ Case join enforces tenant

Projection drift
→ Reconciliation job repairs

Multi-instance scheduler overlap
→ Advisory lock prevents dual execution

Scalability Characteristics

Current complexity:

Reconciliation: O(total cases)

Ledger replay: O(events per case)

Listing: O(page size)

Future optimizations possible:

Snapshot checkpoints

Incremental reconciliation by ledger ts

Tenant sharding

Batch repair windows

Design is deterministic and horizontally safe.

Mental Model

Think of this module as a constitutional court.

It does not create events lightly.
It does not trust projections.
It replays history when challenged.
It repairs drift without rewriting truth.

Cases are not database rows.

They are governed state machines backed by immutable facts.
