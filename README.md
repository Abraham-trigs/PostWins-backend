🚀 PostWins Backend

Governed execution engine for case and grant lifecycle management.

This backend enforces deterministic workflow progression, multi-tenant isolation, policy-aligned routing, and audit-backed traceability across operational lifecycles.

It is not a CRUD API.
It is a stateful execution system.

🧭 Core Principles

Deterministic state transitions (no arbitrary routing)

Multi-tenant isolation

Role-based capability enforcement (RBAC)

Immutable ledger-backed audit logging

Explainable decision modeling

Lifecycle reconciliation & integrity validation

🏗 System Overview

The backend models operational workflows as structured lifecycle transitions:

Intake → Classification → Routing → Verification → Approval → Disbursement → Execution → Reconciliation

Each transition:

Is validated at the service layer

Is constrained by relational schema guarantees

Is recorded in an audit ledger

Can be reconstructed through explainability endpoints

🧩 Architecture
📦 Monorepo Structure

apps/backend

prisma/ → schema + seed

src/domain → domain-level actors and task identifiers

src/modules → bounded operational modules

src/middleware → access enforcement & idempotency

src/lib → observability + Prisma client

src/utils → hashing, UUIDs, helpers

⚙️ Key Modules
📁 Cases

Lifecycle modeling, transition enforcement, explainability mapping, reconciliation jobs.

🧠 Decision Engine

Deterministic evaluation of routing and verification logic.

✅ Verification

Consensus modeling and timeout handling for multi-actor verification flows.

💳 Disbursement

Authorization, execution, and reconciliation of disbursement states.

📥 Intake

Structured intake processing with ledger commit enforcement.

📜 Policies

Auto-routing, task orchestration, and simulation services.

🔍 Explainability

Redaction-aware explanation rendering for role-scoped decision visibility.

🏢 Multi-Tenancy

Tenant isolation is enforced through:

Tenant-aware lifecycle jobs

Service-layer validation

Middleware-level tenant resolution

Policy scoping per tenant

No cross-tenant mutation is permitted.

📚 Audit & Ledger

All significant lifecycle transitions are recorded through ledger commit services.

This enables:

Event reconstruction

State derivation

Lifecycle reconciliation

Explainable decision auditing

The ledger is treated as authoritative history.

🛡 Integrity Enforcement

Integrity is enforced at multiple layers:

Relational schema constraints (Prisma + PostgreSQL)

Service-layer validation pipelines

Deterministic policy evaluation

Lifecycle reconciliation jobs

Invalid transitions are rejected.

▶️ Running the Backend
Install
pnpm install

Setup Environment

Create a .env file with:

DATABASE_URL=postgresql://...
PORT=...

Migrate & Seed
pnpm prisma migrate dev
pnpm prisma db seed

Start Server
pnpm dev

📊 Observability

Request context tracking and structured logging are implemented in:

src/lib/observability

Idempotency middleware prevents duplicate state mutations.

🧪 Testing

Execution and lifecycle integrity tests are located under:

modules/execution/test

Run tests with:

pnpm test

🎯 Design Goals

Enforce correctness over convenience

Model workflow explicitly, not implicitly

Prefer deterministic transitions over manual overrides

Treat auditability as a first-class concern

Keep domain boundaries explicit

🌍 Intended Use

This backend is designed for:

NGO case management platforms

Grant lifecycle enforcement systems

Regulated workflow platforms

Multi-role operational governance systems
