export type GatedEffect =
  | {
      kind: "ROUTE_CASE";
      payload: {
        executionBodyId: string;
      };
    }
  | {
      kind: "AUTHORIZE_BUDGET";
      payload: {
        grantId: string;
        allocationId?: string;
        amount: string; // Decimal as string (Prisma-safe)
        currency: string;
      };
    }
  | {
      kind: "RELEASE_TRANCHE";
      payload: {
        trancheId: string;
      };
    }
  | {
      kind: "AUTHORIZE_DISBURSEMENT";
      payload: {
        type:
          | "PROVIDER_PAYMENT"
          | "BENEFICIARY_PAYMENT"
          | "VENDOR_PAYMENT"
          | "REIMBURSEMENT";
        amount: string; // Decimal as string
        currency: string;
        payeeKind: string;
        payeeId: string;
        executionId: string;
        verificationRecordId: string;
      };
    }
  | {
      kind: "ADVANCE_TASK";
      payload: {
        from: string | null;
        to: string;
      };
    }
  | {
      kind: "ESCALATE_CASE";
      payload: {
        reason: string;
      };
    }
  | {
      kind: "ARCHIVE_CASE";
      payload: {
        reason?: string;
      };
    };
