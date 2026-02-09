export type ViewerContext = {
  tenantId: string;
  userId?: string;
  roles: string[]; // e.g. ["ADMIN"], ["NGO_PARTNER"], ["AUDITOR"]
  actorKind: "HUMAN" | "SYSTEM";
};
