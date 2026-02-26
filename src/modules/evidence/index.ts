// apps/backend/src/modules/evidence/index.ts
// Purpose: Evidence module export entry (NGO/Grant Operations).

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
// - Encapsulates the Evidence domain (Presign + Commit).
// - Exposes routes, controllers, and services for dependency injection.
// - Supports "Exclusive Arc" polymorphic attachments across 4 targets.

export { default as evidenceRoutes } from "./evidence.routes";
export * from "./evidence.controller";
export * from "./evidence.service";
export * from "./evidence.validation"; // Exported for use in Frontend/Shared DTOs
