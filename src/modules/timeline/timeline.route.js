"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const timeline_controller_1 = require("./timeline.controller");
const router = (0, express_1.Router)();
router.get("/:projectId", timeline_controller_1.getTimeline);
exports.default = router;
