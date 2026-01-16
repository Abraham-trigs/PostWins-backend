export type PostWinType = 'PROGRESS' | 'REQUEST' | 'EXECUTION';
export interface PostaContext {
    role: 'AUTHOR' | 'BENEFICIARY' | 'VERIFIER' | 'NGO_PARTNER';
    isImplicit: boolean;
}
export interface PostWin {
    id: string;
    taskId: string;
    location?: {
        lat: number;
        lng: number;
    };
    preferredBodyId?: string;
    assignedBodyId?: string;
    routingStatus: 'UNASSIGNED' | 'ROUTING' | 'MATCHED' | 'EXECUTED' | 'FALLBACK' | 'BLOCKED';
    verificationRecords: VerificationRecord[];
    auditTrail: AuditEntry[];
    notes?: string;
    description: string;
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
        verifiedAt?: string;
    };
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
    signature: string;
}
export interface VerificationStep {
    role: 'VERIFIER' | 'NGO_PARTNER';
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    timestamp?: number;
    verifierId?: string;
}
export interface PostWinVerification {
    postWinId: string;
    requiredConsensus: number;
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
    order: number;
    label: string;
    requiredForSdg: 'SDG_4' | 'SDG_5';
    dependencies: string[];
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
    location: {
        lat: number;
        lng: number;
        radius: number;
    };
    capabilities: ('SDG_4' | 'SDG_5')[];
    trustScore: number;
}
export interface LocalizationContext {
    detectedLanguage: string;
    confidence: number;
    regionalDialect?: string;
    requiresTranslation: boolean;
}
export declare const KHALISTAR_ID = "Khalistar_Foundation";
//# sourceMappingURL=types.d.ts.map