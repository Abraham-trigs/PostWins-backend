"use strict";
// packages/core/src/constants.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.SDG_TARGETS = exports.POSTA_CONSTITUTION = void 0;
exports.POSTA_CONSTITUTION = {
    TONE: 'NEUTRAL_HUMAN',
    AVOID_LANG: ['donor', 'poverty', 'desperate', 'help'],
    REQUIRED_SDGS: ['SDG_4', 'SDG_5'],
    GOVERNANCE: {
        CAN_APPROVE_FUNDING: false,
        CAN_REJECT_LIVED_EXPERIENCE: false,
        CAN_OVERRIDE_HUMAN: false
    }
};
exports.SDG_TARGETS = {
    SDG_4: {
        PRIMARY: '4.1', // Universal primary/secondary education
        LITERACY: '4.6', // Youth and adult literacy
        FACILITIES: '4.a' // Education facilities/infrastructure
    },
    SDG_5: {
        DISCRIMINATION: '5.1', // Ending discrimination
        EMPOWERMENT: '5.b' // Tech/Empowerment
    }
};
