// packages/core/src/types.ts

export type PostWinType = 'PROGRESS' | 'REQUEST' | 'EXECUTION';

export interface PostaContext {
  role: 'AUTHOR' | 'BENEFICIARY' | 'VERIFIER' | 'NGO_PARTNER';
  isImplicit: boolean;
}

export interface PostWin {
  id: string;
  taskId: string; // The specific step in the journey
  location?: { lat: number; lng: number };
  preferredBodyId?: string; // Author's choice (Requirement 2)
  assignedBodyId?: string;  // Final matched body
  routingStatus: 'UNASSIGNED' | 'ROUTING' | 'MATCHED' | 'EXECUTED' | 'FALLBACK' | 'BLOCKED';
  verificationRecords: VerificationRecord[];
  auditTrail: AuditEntry[];
  notes?: string;
  description: string; // Must be neutral/respectful
  beneficiaryId: string;
  authorId: string;
  sdgGoals: ('SDG_4' | 'SDG_5')[];
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FLAGGED';
  mode: 'MOCK' | 'ASSISTED' | 'AI_AUGMENTED';
  localization?: LocalizationContext;
}
export interface VerificationRecord {
  sdgGoal: string;
  requiredVerifiers: number;
  receivedVerifications: string[];
  consensusReached: boolean;
   timestamps: {
    routedAt: string;
    verifiedAt?: string; // Section D.5: Tracks time to consensus
  }
}


export interface AuditEntry {
  action: string;
  actor: string;
  timestamp: string;
  assignedBodyId?: string;
  note?: string;
}

export interface AuditRecord {
  timestamp: number;
  postWinId: string;
  action: 'INTAKE' | 'VERIFIED' | 'ROUTED' | 'FLAGGED' | 'EXECUTED';
  actorId: string; 
  previousState: string;
  newState: string;
  commitmentHash: string; 
  signature: string;

}

export interface LedgerCommitment {
  hash: string;
  signature: string; // Digital signature for Section L.3
}

export interface VerificationStep {
  role: 'VERIFIER' | 'NGO_PARTNER';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  timestamp?: number;
  verifierId?: string;
}

export interface PostWinVerification {
  postWinId: string;
  requiredConsensus: number; // e.g., 2 out of 3
  steps: VerificationStep[];
  startedAt: number;
}

export interface IntegrityFlag {
  type: 'DUPLICATE_CLAIM' | 'SUSPICIOUS_TONE' | 'IDENTITY_MISMATCH';
  severity: 'LOW' | 'HIGH';
  timestamp: number;
}

export interface Task {
  id: string;
  order: number; // Vertical sequence
  label: string; // e.g., "Enrolment", "Module 1", "Final Assessment"
  requiredForSdg: 'SDG_4' | 'SDG_5';
  dependencies: string[]; // IDs of tasks that must be done first
}

export interface Journey {
  id: string;
  beneficiaryId: string;
  currentTaskId: string;
  completedTaskIds: string[];
}

export interface ExecutionBody {
  id: string;
  name: string;
  location: { lat: number; lng: number; radius: number };
  capabilities: ('SDG_4' | 'SDG_5')[];
  trustScore: number;
}

export interface LocalizationContext {
  detectedLanguage: string;
  confidence: number;
  regionalDialect?: string;
  requiresTranslation: boolean;
}


export const KHALISTAR_ID = 'Khalistar_Foundation'; // Requirement 3
