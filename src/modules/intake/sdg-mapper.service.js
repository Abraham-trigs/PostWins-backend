"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SDGMapperService = void 0;
// apps/backend/src/modules/intake/sdg-mapper.service.ts
const core_1 = require("@posta/core");
class SDGMapperService {
    KEYWORD_MAP = {
        SDG_4: ['school', 'education', 'fees', 'learning', 'teacher', 'student', 'enrolment', 'literacy', 'uniform'],
        SDG_5: ['gender', 'equality', 'woman', 'girl', 'empowerment', 'rights', 'bias']
    };
    /**
     * Section A.3: Initial Goal Assignment
     * Used during handleIntake to set the primary SDG categories.
     */
    mapMessageToGoals(message) {
        const text = message.toLowerCase();
        const goals = [];
        if (this.KEYWORD_MAP.SDG_4.some(k => text.includes(k)))
            goals.push('SDG_4');
        if (this.KEYWORD_MAP.SDG_5.some(k => text.includes(k)))
            goals.push('SDG_5');
        // Default to SDG_4 per JourneyService dependency
        return goals.length > 0 ? goals : ['SDG_4'];
    }
    /**
     * Section O.1: Automatically tags PostWins for institutional reporting
     * Maps content to specific SDG 4 and SDG 5 sub-targets.
     */
    async mapImpact(postWin) {
        const tags = [];
        const text = postWin.description.toLowerCase();
        // Mapping to SDG 4 Sub-Targets via [Posta Core Constants](url)
        if (text.includes('school') || text.includes('uniform')) {
            tags.push(core_1.SDG_TARGETS.SDG_4.PRIMARY);
        }
        if (text.includes('read') || text.includes('write') || text.includes('literacy')) {
            tags.push(core_1.SDG_TARGETS.SDG_4.LITERACY);
        }
        // Mapping to SDG 5 Sub-Targets
        if (text.includes('girl') || text.includes('woman') || text.includes('empowerment')) {
            tags.push(core_1.SDG_TARGETS.SDG_5.EMPOWERMENT);
        }
        return tags;
    }
}
exports.SDGMapperService = SDGMapperService;
