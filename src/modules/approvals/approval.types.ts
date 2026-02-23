// apps/backend/src/modules/approvals/approval.types.ts
// Purpose: Canonical governance effect definitions used by approval / workflow engine.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Design reasoning
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Governance effects must be explicit, serializable, and deterministic.
// - Identity provisioning must require invite token issuance unless user already exists.
// - Effects are append-only to preserve audit integrity.
// - Payloads must remain minimal, canonical, and persistence-safe.

///////////////////////////////////////////////////////////////////////////////////////////////////
// Structure
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Discriminated union via `kind`
// - Strict payload typing per effect
// - Decimal values represented as string (Prisma-safe)
// - Identity provisioning explicitly separated from lifecycle mutation

///////////////////////////////////////////////////////////////////////////////////////////////////
// Implementation guidance
///////////////////////////////////////////////////////////////////////////////////////////////////
// - Always exhaustively switch on `effect.kind`
// - Never infer payload shape dynamically
// - Never create users directly inside effect execution
// - Provision identity ONLY via invite token issuance when user does not exist
// - Assign role only when user already exists

///////////////////////////////////////////////////////////////////////////////////////////////////
// Scalability insight
///////////////////////////////////////////////////////////////////////////////////////////////////
// Effects are immutable governance artifacts.
// Extend union with new kinds instead of mutating existing ones.
// Keep effects tenant-safe and transaction-safe.
// Identity provisioning remains policy-driven and auditable.
///////////////////////////////////////////////////////////////////////////////////////////////////

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
    }
  | {
      /**
       * Governance-driven identity provisioning.
       *
       * Behavior:
       * - If user exists in tenant → assign role only.
       * - If user does NOT exist → issue invite token.
       * - Never create user directly here.
       * - Invite acceptance flow performs user creation.
       */
      kind: "PROVISION_VERIFIER";
      payload: {
        email: string;
        roleKey: string; // Must exist within tenant
      };
    }
  | {
      /**
       * Verification consensus reached.
       * Lifecycle mutation delegated to orchestrator.
       */
      kind: "EXECUTION_VERIFIED";
    };
