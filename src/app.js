"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const intake_routes_1 = __importDefault(require("./modules/intake/intake.routes"));
const timeline_route_1 = __importDefault(require("./modules/timeline/timeline.route"));
const app = (0, express_1.default)();
// Middleware
app.use(express_1.default.json({ limit: "1mb" }));
// Routes
app.use("/api/intake", intake_routes_1.default);
app.use("/api/timeline", timeline_route_1.default);
app.get("/health", (_req, res) => {
    res.json({
        status: "Posta Online",
        mode: process.env.NODE_ENV,
    });
});
exports.default = app;
