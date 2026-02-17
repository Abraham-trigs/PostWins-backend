export type GatedEffect =
  | {
      kind: "ROUTE_CASE";
      payload: { executionBodyId: string };
    }
  | {
      kind: "AUTHORIZE_BUDGET";
      payload: { amount: string; currency: string };
    }
  | {
      kind: "ADVANCE_TASK";
      payload: { from: string | null; to: string };
    };
