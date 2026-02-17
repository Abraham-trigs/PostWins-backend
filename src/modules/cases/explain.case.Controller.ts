// src/modules/cases/explain.case.Controller.ts
// Controller for explain-case endpoint. Normalizes input into canonical CaseRef and handles domain errors.

import { Request, Response, NextFunction } from "express";
import { caseExplainService } from "./case-explain.service";
import { mapExplainableCaseToResponse } from "./explain.case.mapper";
import { ExplainCaseRequest } from "./explain.case.contract";
import {
  CaseNotFoundError,
  CaseForbiddenError,
  ResolverError,
} from "./case.errors";
import {
  CaseRef,
  caseRef,
  decisionRef,
  policyRef,
  ledgerRef,
  tagRef,
} from "./case-ref";
import { ViewerContext } from "../security/viewer-context";

type AugmentedRequest = Request & {
  tenantId: string;
  viewer: ViewerContext;
};

function normalizeRef(input: ExplainCaseRequest["ref"]): CaseRef {
  switch (input.kind) {
    case "CASE":
      if (!input.id) throw new ResolverError("Missing CASE id");
      return caseRef(input.id);

    case "DECISION":
      if (!input.id) throw new ResolverError("Missing DECISION id");
      return decisionRef(input.id);

    case "POLICY":
      if (!input.policyKey) throw new ResolverError("Missing POLICY key");
      return policyRef(input.policyKey);

    case "LEDGER":
      if (!input.id) throw new ResolverError("Missing LEDGER id");
      return ledgerRef(input.id);

    case "TAG":
      if (!input.value) throw new ResolverError("Missing TAG value");
      return tagRef(input.value);

    default:
      throw new ResolverError("Invalid reference");
  }
}

export async function explainCaseController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const augmented = req as AugmentedRequest;

  try {
    const body = augmented.body as ExplainCaseRequest;

    const ref = normalizeRef(body.ref);

    const payload = await caseExplainService.explain({
      tenantId: augmented.tenantId,
      ref,
      viewer: augmented.viewer,
    });

    const response = mapExplainableCaseToResponse(payload);

    return res.status(200).json(response);
  } catch (err) {
    if (err instanceof CaseNotFoundError) {
      return res.status(404).json({ error: "Case not found" });
    }

    if (err instanceof CaseForbiddenError) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (err instanceof ResolverError) {
      return res.status(404).json({ error: err.message });
    }

    return next(err);
  }
}
