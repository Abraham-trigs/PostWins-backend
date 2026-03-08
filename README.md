# Posta Backend 🧭

The Posta backend is a domain-driven TypeScript API designed to power a deterministic, explainable workflow platform. It models institutional processes as structured, transparent workflows rather than simple CRUD operations.

## Architecture Overview 🏗️

The system is implemented as a Node.js TypeScript server following a **Domain-Modular Architecture**. Each module encapsulates a specific business capability, maintaining strong boundaries while sharing a robust infrastructure layer.

### Core Priorities
* **Domain Ownership:** Clear separation of concerns between business logic.
* **Explainability:** Ledger-backed audit trails for every authoritative action.
* **Explicit Policy:** Decisions are driven by logic policies, not hidden condition chains.
* **Resilience:** Idempotent request handling and multi-tenant isolation.

---

## Backend Structure 🧩

```text
apps/backend
├── prisma/             # Database schema and migrations
├── src/
│   ├── modules/        # Primary Domain Modules (The "Core")
│   ├── lib/            # Shared infrastructure (Redis, Logger, etc.)
│   ├── middleware/     # Auth, Idempotency, and Guards
│   ├── shared/         # Common types and utilities
│   ├── app.ts          # Express/Server configuration
│   └── server.ts       # Entry point
```

<p align="center">
  <img width="848" alt="Posta Backend Architecture" src="https://github.com/user-attachments/assets/a71224d2-a7ac-43a8-bbfb-1e4c3d4b0db2" />
</p>
