// src/modules/security/explainable-case.redactor.ts

import { resolveRedactionPolicy } from "../security/redaction.policy";
import { ViewerContext } from "../security/viewer-context";

export class ExplainableCaseRedactor {
  redact(payload: any, viewer: ViewerContext) {
    const policy = resolveRedactionPolicy(viewer);
    const redacted = structuredClone(payload);

    ////////////////////////////////////////////////////////////////
    // 0️⃣ Tag-based restriction
    ////////////////////////////////////////////////////////////////

    const hasRestrictedTag =
      redacted.case?.tags?.some((t: any) => t.tag?.isRestricted === true) ??
      false;

    if (hasRestrictedTag && !policy.canSeeRestrictedCases) {
      return {
        id: redacted.case.id,
        lifecycle: redacted.lifecycle,
        restricted: true,
      };
    }

    ////////////////////////////////////////////////////////////////
    // 1️⃣ PII stripping
    ////////////////////////////////////////////////////////////////

    if (!policy.canSeePII) {
      if (redacted.case?.beneficiary?.pii) {
        delete redacted.case.beneficiary.pii;
      }
    }

    ////////////////////////////////////////////////////////////////
    // 2️⃣ Evidence masking
    ////////////////////////////////////////////////////////////////

    if (!policy.canSeeEvidence) {
      redacted.case.timelineEntries =
        redacted.case.timelineEntries?.map((e: any) => ({
          ...e,
          evidence: [],
        })) ?? [];
    }

    ////////////////////////////////////////////////////////////////
    // 3️⃣ Superseded decision visibility
    ////////////////////////////////////////////////////////////////

    if (!policy.canSeeSupersededDecisions) {
      redacted.authority.history = redacted.authority.active;
    }

    ////////////////////////////////////////////////////////////////
    // 3️⃣.1️⃣ Decision field redaction
    ////////////////////////////////////////////////////////////////

    if (!policy.canSeeSupersededDecisions) {
      redacted.authority.history = redacted.authority.history.map((d: any) => {
        const { actorUserId, intentContext, ...rest } = d;
        return rest;
      });

      redacted.authority.active = redacted.authority.active.map((d: any) => {
        const { actorUserId, intentContext, ...rest } = d;
        return rest;
      });
    }

    ////////////////////////////////////////////////////////////////
    // 4️⃣ Ledger payload masking
    ////////////////////////////////////////////////////////////////

    if (!policy.canSeeLedgerPayloads) {
      redacted.ledger = redacted.ledger.map((l: any) => ({
        id: l.id,
        eventType: l.eventType,
        ts: l.ts,
        actorKind: l.actorKind,
      }));
    }

    return redacted;
  }
}
