"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalizationService = void 0;
class LocalizationService {
    /**
     * Section N.1: Identifies language, dialect, and cultural context
     * Supports Requirement N.1: "Identifies language/dialect from first message"
     */
    async detectCulture(message) {
        // In production, integrate with the [Google Cloud Translation API](cloud.google.com) 
        // or [FastText](fasttext.cc) for offline-first privacy.
        const isLocalDialect = this.checkForRegionalSlang(message);
        const text = message.toLowerCase();
        // Simple detection logic for monorepo demonstration
        let detectedLanguage = 'en';
        if (/\b(hola|gracias)\b/.test(text))
            detectedLanguage = 'es';
        if (/\b(bonjour|merci)\b/.test(text))
            detectedLanguage = 'fr';
        return {
            detectedLanguage,
            confidence: 0.95,
            regionalDialect: isLocalDialect ? 'West_African_Pidgin' : undefined,
            requiresTranslation: isLocalDialect || detectedLanguage !== 'en'
        };
    }
    /**
     * Section N.2: Cultural Neutralization
     * Translates intent and sentiment into "Neutral Human Tone" (Section C)
     */
    async neutralizeAndTranslate(message, context) {
        if (!context.requiresTranslation)
            return message.trim();
        // Mapping regional idioms to neutral, respectful descriptions (Section C)
        let neutralized = message.toLowerCase();
        if (context.regionalDialect === 'West_African_Pidgin') {
            neutralized = neutralized
                .replace(/i no get/g, 'I am currently without')
                .replace(/pikin/g, 'child')
                .replace(/dash/g, 'support/gift');
        }
        // Capitalize first letter for professional neutral tone
        return neutralized.charAt(0).toUpperCase() + neutralized.slice(1);
    }
    /**
     * Helper to identify regional linguistic markers
     */
    checkForRegionalSlang(message) {
        const slangTerms = ['pikin', 'dash', 'no get', 'wa hala', 'kobo'];
        return slangTerms.some(term => message.toLowerCase().includes(term));
    }
}
exports.LocalizationService = LocalizationService;
