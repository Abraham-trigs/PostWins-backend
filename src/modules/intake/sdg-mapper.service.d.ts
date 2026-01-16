import { PostWin } from "@posta/core";
export declare class SDGMapperService {
    private readonly KEYWORD_MAP;
    /**
     * Section A.3: Initial Goal Assignment
     * Used during handleIntake to set the primary SDG categories.
     */
    mapMessageToGoals(message: string): ('SDG_4' | 'SDG_5')[];
    /**
     * Section O.1: Automatically tags PostWins for institutional reporting
     * Maps content to specific SDG 4 and SDG 5 sub-targets.
     */
    mapImpact(postWin: PostWin): Promise<string[]>;
}
//# sourceMappingURL=sdg-mapper.service.d.ts.map