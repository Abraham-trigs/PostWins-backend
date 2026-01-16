"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/modules/health/health.controller.ts
const express_1 = require("express");
const ledger_service_1 = require("../intake/ledger.service");
const router = (0, express_1.Router)();
const ledgerService = new ledger_service_1.LedgerService();
router.get("/health/ledger", (req, res) => {
    const healthData = ledgerService.getStatus();
    // Return 200 for healthy, 503 for corruption
    const statusCode = healthData.status === "HEALTHY" ? 200 : 503;
    res.status(statusCode).json(healthData);
});
exports.default = router;
