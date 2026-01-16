import { LocalizationContext } from "@posta/core";
export declare class LocalizationService {
    /**
     * Section N.1: Identifies language, dialect, and cultural context
     * Supports Requirement N.1: "Identifies language/dialect from first message"
     */
    detectCulture(message: string): Promise<LocalizationContext>;
    /**
     * Section N.2: Cultural Neutralization
     * Translates intent and sentiment into "Neutral Human Tone" (Section C)
     */
    neutralizeAndTranslate(message: string, context: LocalizationContext): Promise<string>;
    /**
     * Helper to identify regional linguistic markers
     */
    private checkForRegionalSlang;
}
//# sourceMappingURL=localization.service.d.ts.map