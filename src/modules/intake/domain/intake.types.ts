import { OperationalMode, AccessScope, CaseType } from "@prisma/client";

export type IntakeMetadata = {
  mode: OperationalMode;
  scope: AccessScope;
  intent: CaseType;
};

export type IntakeResult = IntakeMetadata & {
  description: string;
  literacyLevel: "LOW" | "STANDARD";
};

export type DetectedContext = {
  role: "AUTHOR" | "BENEFICIARY" | "VERIFIER" | "NGO_PARTNER";
  isImplicit: boolean;
  literacyLevel: "LOW" | "STANDARD";
};
