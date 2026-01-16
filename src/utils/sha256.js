"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Hex = sha256Hex;
exports.stableStringify = stableStringify;
const node_crypto_1 = __importDefault(require("node:crypto"));
function sha256Hex(input) {
    return node_crypto_1.default.createHash("sha256").update(input).digest("hex");
}
function stableStringify(obj) {
    if (obj === null || typeof obj !== "object")
        return JSON.stringify(obj);
    if (Array.isArray(obj))
        return JSON.stringify(obj.map(stableStringify));
    const keys = Object.keys(obj).sort();
    const out = {};
    for (const k of keys)
        out[k] = obj[k];
    return JSON.stringify(out);
}
