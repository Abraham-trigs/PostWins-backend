Evidence Module

Secure, multi-tenant, polymorphic evidence management for NGO / grant operations.

This module governs how files enter the system, how they are attached to workflow entities, how they are accessed, and how downloads are monitored. It is designed for auditability, tenant isolation, and forward-compatible anomaly detection.

It does not own business workflows. It owns file integrity, attachment correctness, and access accountability.

Why This Module Exists

Evidence in Posta is not “file storage.”
It is legally meaningful documentation attached to workflow artifacts.

If evidence is:

Attached to the wrong object

Accessible cross-tenant

Downloaded without traceability

Mutable after commit

The integrity of the entire system collapses.

This module exists to prevent that.

Responsibilities

This module owns:

Secure S3 presigned upload flow

Commit-time integrity validation

Exclusive-arc polymorphic attachment enforcement

Strict tenant isolation

Secure presigned download generation

Non-blocking audit logging

Lightweight behavioral risk scoring

Paginated, filterable listing

This module does not:

Decide workflow transitions

Enforce approval policies

Evaluate authorization beyond tenant + authenticated identity

Store raw file binaries

Architectural Boundaries

Controller
Owns HTTP boundary + authentication checks only.

Service
Owns:

Validation enforcement

Tenant isolation

Domain-level invariants

Storage interaction

Integrity guarantees

Validation Layer (Zod)
Owns structural correctness and XOR enforcement to prevent schema drift.

Routes
Expose clean REST semantics without mixing metadata and binary concerns.

Core Concepts

1. Two-Phase Upload (Presign → Commit)

Uploads are intentionally split:

Presign

Validates intent and attachment target

Issues secure S3 upload URL

Does not create database record

Commit

Validates integrity (SHA256, storageKey, byteSize)

Enforces tenant + case alignment

Persists immutable evidence record

This prevents:

Orphaned database rows

Unverified storage writes

Cross-tenant injection

Hash spoofing

2. Exclusive Arc (Polymorphic Attachment)

Evidence must attach to exactly one of:

timelineEntryId

caseTaskId

verificationRecordId

approvalRequestId

Never zero. Never multiple.

This is enforced at validation level via strict XOR logic.

Why?

Because allowing multiple attachment targets creates:

Ambiguous ownership

Impossible lifecycle guarantees

Reporting inconsistencies

Single ownership is a design invariant.

3. Tenant Isolation

Every operation requires:

req.user.tenantId

For commit and download: req.user.id

All queries are scoped by tenantId.

Download risk queries explicitly include userId to prevent accidental tenant-wide aggregation.

This avoids cross-user behavioral contamination and false anomaly scoring.

4. Download Risk Scoring

Each download triggers:

Behavioral window: last 5 minutes

Count of downloads per user within tenant

Deterministic risk scoring:

10 downloads → risk 40

20 downloads → risk 70

= 70 → flagged

Audit logging:

Never blocks UX

Runs async

Indexed on (tenantId, userId, createdAt)

This is intentionally explainable and deterministic.
It is a foundation, not a full anomaly engine.

Future-ready for:

Lockout policies

ML anomaly detection

Alert pipelines

Public API

All routes require authentication.

GET /api/evidence
Paginated listing with filters:

search

caseId

timelineEntryId

caseTaskId

verificationRecordId

approvalRequestId

sort (asc | desc)

POST /api/evidence/presign
Generates secure S3 upload URL.

POST /api/evidence/commit
Finalizes evidence after successful upload.

GET /api/evidence/:id/download
Generates secure presigned GET URL and logs access behavior.

Data Integrity Guarantees

SHA256 required and regex-validated

UUID validation on all relational IDs

Exactly one polymorphic attachment target

Case-aware commit validation

Unique constraint protection against duplicate file submissions

Immutable storage key after commit

Security Posture

Authentication required for all endpoints.

Tenant isolation enforced at:

Service layer

Query layer

Audit layer

Download logging captures:

tenantId

evidenceId

userId

purpose (VIEW | EXPORT)

ipAddress

userAgent

requestId

riskScore

flagged

Audit failure does not block download.

This prevents audit subsystem outages from degrading UX.

Failure Modes Considered

Duplicate file submission
→ Returns 409 with deterministic message.

Undefined Prisma filter edge cases
→ Conditional object spread prevents invalid where clauses.

Tenant-wide risk aggregation
→ userId required for behavioral scoring.

Audit logging failure
→ Caught and swallowed intentionally.

Indexing Requirements

Recommended composite index:

(tenantId, userId, createdAt)

Why?

Because download risk scoring depends on time-window counts.
Without proper indexing, this becomes a latency amplifier.

Scalability Characteristics

Upload flow scales horizontally because:

Storage writes are offloaded to S3

Commit is a single transactional write

Audit logging is asynchronous

Listing scales via:

Pagination

Indexed tenant filtering

Target-based filtering

Risk scoring is O(1) within indexed time window.

Architecture is safe for:

Advanced anomaly detection

Evidence classification

Regulatory export reporting

Long-term audit retention

Extension Points

Future enhancements can include:

Role-based download gating

Rate limiting middleware

Temporary lockout on repeated high-risk flags

Hash verification against external compliance systems

Encryption key rotation strategy

Presigned GET validation at validation layer

Exclusive Arc extension:
Add new target type by extending PolymorphicTargetFields only.

Invariants (Non-Negotiable)

Evidence belongs to exactly one workflow artifact.

Evidence never crosses tenant boundaries.

Commit must verify integrity metadata.

Download must be auditable.

Audit must not block user experience.

Break these, and the system stops being trustworthy.

Mental Model

Think of this module as a cryptographic notary attached to a workflow engine.

It does not judge the case.
It does not approve the grant.
It ensures that when someone says “this document existed and was attached here,”
the system can prove it.

That distinction is everything in regulated environments.
