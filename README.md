# Posta Backend 🧭

The Posta backend is a **domain-driven TypeScript API** designed to
power a deterministic, explainable workflow platform. It orchestrates
complex case lifecycles, verification processes, routing decisions, and
financial disbursements while maintaining a verifiable audit trail.

The platform behaves as a **policy-driven workflow engine** where system
decisions are evaluated through explicit policies rather than hidden
conditional logic.

------------------------------------------------------------------------

# Architecture 🏗️

The backend is structured as a **domain-modular system** where each
module encapsulates its own business logic, routes, services, and
policies.

### Core Priorities

**Domain Ownership**\
Each business capability exists as an independent module.

**Ledger-Backed Explainability**\
Critical actions are committed to a cryptographically verifiable ledger
for auditability and transparency.

**Explicit Policy Logic**\
Workflow decisions are evaluated through policy engines instead of
implicit condition chains.

**Resilience**\
Tenant isolation, request idempotency, and observability are enforced
through middleware and system infrastructure.

------------------------------------------------------------------------

# Domain Map 🌐

The backend is organized into domain modules that encapsulate business
capabilities.

Core domains include:

  Domain         Responsibility
  -------------- ------------------------------------------------
  Cases          Lifecycle transitions, tagging, reconciliation
  Verification   Consensus-based verification flows
  Routing        Task progression and workflow routing
  Evidence       Evidence submission, validation, processing
  Execution      Milestone completion and execution progress
  Disbursement   Financial authorization and settlement
  Decision       Decision orchestration and explainability
  Intake         Case intake, integrity validation
  Messaging      WebSocket communication and message handling
  Auth           Identity, trust context, invite flows

Each domain is implemented inside:

apps/backend/src/modules

Each module typically contains:

routes\
controllers\
services\
domain logic\
policies\
jobs

------------------------------------------------------------------------

# Backend Structure 🧩

apps/backend ├── prisma/ \# Database schema and seed │ ├── src/ │ ├──
modules/ \# Domain modules │ ├── lib/ \# Infrastructure libraries │ ├──
middleware/ \# Security and request safety │ ├── shared/ \# Shared
utilities │ ├── types/ \# Global typings │ ├── utils/ \# System helpers
│ │ │ ├── app.ts \# Express app setup │ ├── server.ts \# Server entry
point │ └── index.ts \# Bootstrapping

------------------------------------------------------------------------

# Infrastructure & Observability ⚙️

## Database Layer (Prisma)

Database models and migrations are defined in:

prisma/schema.prisma

Responsibilities include:

-   relational modeling
-   transactional writes
-   migrations
-   seed data

------------------------------------------------------------------------

## Middleware & Safety 🛡️

Security and request integrity are enforced through middleware.

Key middleware includes:

auth.middleware.ts\
idempotency.middleware.ts\
requireTenantId.ts\
resolveExplainabilityRole.ts

Responsibilities:

-   authentication enforcement
-   tenant isolation
-   request deduplication
-   access control

------------------------------------------------------------------------

## Observability 👁️

Observability utilities live in:

src/lib/observability

Capabilities include:

-   structured logging
-   request tracing
-   contextual event tracking

This allows the platform to maintain a **full audit trail of system
behavior**.

------------------------------------------------------------------------

# Request Lifecycle 🔄

Every request flows through the following stages:

Client Request\
↓\
Route\
↓\
Controller\
↓\
Policy Evaluation\
↓\
Domain Service\
↓\
Ledger Commit\
↓\
Database Transaction\
↓\
Response

This model ensures:

-   deterministic execution
-   explainable system decisions
-   auditable system state transitions

------------------------------------------------------------------------

# Ledger & Explainability 🔐

The system includes a **ledger-based audit mechanism**.

Ledger components track:

-   authoritative decisions
-   verification outcomes
-   routing events
-   policy evaluations

This enables:

-   system explainability
-   deterministic dispute resolution
-   historical reconstruction of decisions

------------------------------------------------------------------------

# Running the Backend 🚀

From the monorepo root:

Install dependencies

pnpm install

Run backend only

pnpm --filter backend dev

Run full platform

pnpm dev

------------------------------------------------------------------------

# Development Principles 🧠

The backend follows several engineering principles.

-   Domain ownership over layer ownership
-   Services over large controllers
-   Explicit policies over hidden logic
-   Deterministic workflows
-   Strong observability and auditability

------------------------------------------------------------------------

# Quick System Orientation

If you want to understand the entire backend quickly, read these files
first:

apps/backend/src/modules/cases/transitionCaseLifecycleWithLedger.ts\
apps/backend/src/modules/policies/policy-evaluation.service.ts\
apps/backend/src/modules/routing/computeRouting.ts

Together these files reveal the core system architecture:

State machine\
+ Policy engine\
+ Routing engine\
= Posta workflow platform
