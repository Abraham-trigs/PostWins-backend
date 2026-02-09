export type CaseRef =
  | { kind: "CASE"; id: string }
  | { kind: "DECISION"; id: string }
  | { kind: "POLICY"; policyKey: string }
  | { kind: "LEDGER"; id: string }
  | { kind: "TAG"; value: string }; // e.g. "P12457"
