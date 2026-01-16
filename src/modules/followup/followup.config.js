"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.followupConfig = void 0;
exports.followupConfig = {
    checkIntervalHours: 24,
    maxAttempts: 3,
    retryDelayHours: 48,
    timezone: "Africa/Accra",
    email: {
        provider: "sendgrid",
        apiKey: process.env.SENDGRID_API_KEY ?? "",
        from: process.env.FOLLOWUP_FROM ?? "noreply@postwins.com",
    },
};
