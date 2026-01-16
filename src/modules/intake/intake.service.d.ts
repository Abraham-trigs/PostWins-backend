import { PostWin, PostaContext } from "@posta/core";
import { IntegrityService } from "./integrity.service";
import { TaskService } from "../routing/task.service";
/**
 * Interface to extend PostaContext with literacy metadata for ToneAdapter
 */
export interface EnrichedContext extends PostaContext {
    literacyLevel: 'LOW' | 'STANDARD';
    intent: string;
}
export declare class IntakeService {
    private integrityService;
    private taskService;
    constructor(integrityService: IntegrityService, taskService: TaskService);
    /**
     * Section A & N: Implicit Context & Literacy Detection
     * Analyzes the message to determine role and literacy level (Requirement G.2)
     */
    detectContext(message: string): Promise<EnrichedContext>;
    /**
     * Section B: Helper for text normalization
     */
    sanitizeDescription(message: string): string;
    /**
     * Section A: Internal logic for complex intake validation
     * (Used if the controller needs more than just basic context)
     */
    processInternalOrchestration(message: string, deviceId: string): Promise<Partial<PostWin>>;
}
//# sourceMappingURL=intake.service.d.ts.map