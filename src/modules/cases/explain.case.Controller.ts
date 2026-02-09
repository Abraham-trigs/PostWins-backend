import {
  CaseNotFoundError,
  CaseForbiddenError,
  ResolverError,
} from "./case.errors";

export async function explainCaseController(req, res) {
  try {
    const result = await caseExplainService.explain({
      tenantId: req.tenantId,
      ref: req.body.ref,
      viewer: req.viewer,
    });

    return res.status(200).json(result);
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

    throw err; // true 500
  }
}
