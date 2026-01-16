"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntakeService = void 0;
class IntakeService {
    integrityService;
    taskService;
    constructor(integrityService, taskService) {
        this.integrityService = integrityService;
        this.taskService = taskService;
    }
    /**
     * Section A & N: Implicit Context & Literacy Detection
     * Analyzes the message to determine role and literacy level (Requirement G.2)
     */
    async detectContext(message) {
        const msg = message.toLowerCase();
        // 1. Role Detection (Requirement A.1)
        let role = 'BENEFICIARY'; // Default for intake
        if (msg.includes('partner') || msg.includes('organization') || msg.includes('ngo')) {
            role = 'NGO_PARTNER';
        }
        // 2. Literacy Scoring (Requirement G.2)
        // Simple heuristic: length and word complexity
        const words = message.trim().split(/\s+/);
        const avgWordLength = message.length / (words.length || 1);
        // If message is very short or words are extremely simple, flag as LOW literacy
        const literacyLevel = (words.length < 6 || avgWordLength < 4) ? 'LOW' : 'STANDARD';
        return {
            role,
            isImplicit: true,
            literacyLevel,
            intent: 'CLAIM_SUBMISSION'
        };
    }
    /**
     * Section B: Helper for text normalization
     */
    sanitizeDescription(message) {
        // Ensures neutral/respectful formatting by removing excess whitespace and newlines
        return message.trim().replace(/\s+/g, ' ');
    }
    /**
     * Section A: Internal logic for complex intake validation
     * (Used if the controller needs more than just basic context)
     */
    async processInternalOrchestration(message, deviceId) {
        const context = await this.detectContext(message);
        // Minimal temporary object for integrity check
        const tempPostWin = { beneficiaryId: 'pending' };
        const flags = await this.integrityService.performFullAudit(tempPostWin, message, deviceId);
        if (flags.some(f => f.severity === 'HIGH')) {
            throw new Error("Intake blocked by Integrity Guardrails: High severity anomaly detected.");
        }
        return {
            description: this.sanitizeDescription(message),
            verificationStatus: flags.length > 0 ? 'FLAGGED' : 'PENDING',
            mode: 'AI_AUGMENTED',
            routingStatus: 'UNASSIGNED'
        };
    }
}
exports.IntakeService = IntakeService;
