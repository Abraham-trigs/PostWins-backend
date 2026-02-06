import { Router } from "express";
import { listCases } from "./cases.controller";

export const casesRouter = Router();

casesRouter.get("/", listCases);
