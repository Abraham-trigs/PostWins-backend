import { Router, type Router as ExpressRouter } from "express";
import { listCases } from "./cases.controller";

export const casesRouter: ExpressRouter = Router();

casesRouter.get("/", listCases);
