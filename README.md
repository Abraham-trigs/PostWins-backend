Overview 🧭

The backend is organized into roughly 10+ domain modules including cases,
verification, routing, evidence, execution, disbursement, decisioning,
intake, messaging, and authentication. Each domain owns its routes,
controllers, services, policies, and orchestration logic, allowing the
system to scale without tightly coupling unrelated concerns.

The architecture follows a domain-modular service design where each
domain module encapsulates its own behavior while sharing common
infrastructure such as database access, observability, authentication
middleware, and system policies.

This backend powers the Posta platform, providing workflow
orchestration, verification processes, evidence tracking, lifecycle
transitions, and communication capabilities.

Architecture 🏗️

The backend is implemented as a Node.js TypeScript API server using
modular domain architecture.

Core responsibilities include:

Authentication and identity verification 🔐 Workflow orchestration 🔄
Case lifecycle management 📂 Evidence and verification handling 🧾
Messaging and collaboration 💬 Decision evaluation 🧠 Routing and task
progression 🧭 Ledger-backed system explainability 📜 Observability and
audit logging 👁️

The architecture prioritizes:

Domain ownership Explicit system behavior auditable decision systems
strong boundaries between modules

Backend Structure 🧩

High-level layout:

apps/backend │ ├── prisma │ ├── schema.prisma │ └── seed.ts │ ├── src │
├── constants │ ├── domain │ ├── lib │ ├── middleware │ ├── modules │
├── shared │ ├── types │ ├── utils │ │ │ ├── app.ts │ ├── server.ts │
└── index.ts

Core Infrastructure ⚙️

Prisma (Database Layer) 🗄️ prisma/schema.prisma

Defines relational data models used across domains.

Handles:

database relations migrations transactional writes seed data

Shared Libraries 🧰 src/lib

Includes:

prisma client redis logging observability cookie utilities websocket
authentication S3 integration

Example:

src/lib/prisma.ts src/lib/logger.ts src/lib/request-context.ts

Middleware 🛡️ src/middleware

Responsible for request validation and contextual guards.

Examples:

auth.middleware.ts idempotency.middleware.ts requireTenantId.ts
resolveExplainabilityRole.ts

These ensure:

tenant safety request deduplication authentication enforcement access
control

Domain Modules 🧩

The system is organized into domain modules inside:

src/modules

Each module encapsulates a business capability.

Example module structure:

modules/cases │ ├── cases.controller.ts ├── cases.routes.ts ├──
transitionCaseLifecycle.ts ├── deriveCaseCapabilities.service.ts ├──
caseTag.service.ts ├── case.errors.ts

Modules generally include:

routes controllers services domain logic policy evaluation lifecycle
transitions

Primary Domains 🌐

Cases 📂

Handles the lifecycle of cases from creation to resolution.

Includes:

lifecycle transitions tagging case capabilities explanation mapping
reconciliation jobs

Verification ✔️

Handles consensus-based verification flows.

Includes:

verification orchestration verification requests timeout handling
consensus evaluation

Routing 🧭

Responsible for determining where work should go.

Includes:

routing orchestration task progression journey modeling routing
simulation

Evidence 🧾

Handles evidence submission and validation.

Includes:

evidence upload evidence validation evidence processing

Execution 🚧

Manages execution of approved work.

Includes:

milestone completion progress tracking execution verification

Disbursement 💰

Handles financial disbursement flows.

Includes:

authorization execution reconciliation jobs

Decision 🧠

Handles decision orchestration and queries.

Includes:

decision resolution decision explanation decision query APIs

Intake 📥

Handles case intake and data collection.

Includes:

intake bootstrapping intake delivery flows integrity checks location
detection

Messaging 💬

Handles system communication.

Includes:

message sending read positions websocket events message receipts

Authentication 🔐

Handles identity and access.

Includes:

login flows invite acceptance refresh tokens trust context building

Ledger and Explainability 📜

The system includes a ledger-based explainability model.

Key components:

modules/intake/ledger modules/explainability modules/security

The ledger records:

authoritative decisions policy evaluations routing events verification
outcomes

This allows:

deterministic audit trails explainable system behavior dispute
resolution support

Observability 👁️

System observability is implemented through:

src/lib/observability

Includes:

structured logging request context tracking traceable event logs

Running the Backend 🚀

From the monorepo root:

pnpm install pnpm --filter backend dev

or run the entire platform:

pnpm dev

Backend Development Principles 🧠

The backend is designed with the following principles:

Domain ownership over layer ownership Services over large controllers
Explicit system policies Explainable decisions Deterministic workflows
Strong observability
