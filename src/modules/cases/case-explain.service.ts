import { CaseRef } from "./case-ref";
import { CaseRefResolver } from "./case-ref.resolver";
import { ExplainableCaseLoader } from "./explainable-case.loader";
import { ExplainableCaseRedactor } from "../security/explainable-case.redactor";
import { ViewerContext } from "../security/viewer-context";

export class CaseExplainService {
  private resolver = new CaseRefResolver();
  private loader = new ExplainableCaseLoader();
  private redactor = new ExplainableCaseRedactor();

  async explain(params: {
    tenantId: string;
    ref: CaseRef;
    viewer: ViewerContext;
  }) {
    const { tenantId, ref, viewer } = params;

    const { caseId } = await this.resolver.resolve(ref, tenantId);

    const payload = await this.loader.load({
      tenantId,
      caseId,
    });

    return this.redactor.redact(payload, viewer);
  }
}
