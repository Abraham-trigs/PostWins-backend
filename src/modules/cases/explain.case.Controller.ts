import { caseExplainService } from "./case-explain.service";
import { mapExplainableCaseToResponse } from "./explain.case.mapper";
import { ExplainCaseRequest } from "./explain.case.contract";
import {
  CaseNotFoundError,
  CaseForbiddenError,
  ResolverError,
} from "./case.errors";

export async function explainCaseController(req, res) {
  try {
    const body = req.body as ExplainCaseRequest;

    const payload = await caseExplainService.explain({
      tenantId: req.tenantId,
      ref: body.ref,
      viewer: req.viewer,
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
      return res.status(404).json({ error: "Invalid reference" });
    }

    throw err;
  }
}
