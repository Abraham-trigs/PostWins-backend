import { CaseRef } from "./case-ref";
import { CaseRefResolver } from "./case-ref.resolver";
import { ExplainableCaseLoader } from "./explainable-case.loader";

export class CaseExplainService {
  private resolver = new CaseRefResolver();
  private loader = new ExplainableCaseLoader();

  async explain(params: { tenantId: string; ref: CaseRef }) {
    const { tenantId, ref } = params;

    const { caseId } = await this.resolver.resolve(ref, tenantId);

    return this.loader.load({
      tenantId,
      caseId,
    });
  }
}
