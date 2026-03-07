// apps/backend/src/modules/intake/ledger/ledger.errors.ts
// Purpose: Domain errors used by the ledger authority service.

////////////////////////////////////////////////////////////////
// Design reasoning
////////////////////////////////////////////////////////////////
/*
Ledger errors represent domain-level violations of the sovereign ledger
rules. Separating them allows other modules (verification, routing,
decision engines) to import the same error types without depending on
the ledger service implementation.
*/

////////////////////////////////////////////////////////////////
// Structure
////////////////////////////////////////////////////////////////
/*
Exports
- LedgerValidationError
- LedgerSupersessionError
*/

////////////////////////////////////////////////////////////////
// Implementation
////////////////////////////////////////////////////////////////

export class LedgerValidationError extends Error {
  public readonly details: Record<string, string[] | undefined>;

  constructor(details: Record<string, string[] | undefined>) {
    super("Invalid ledger commit input");
    this.name = "LedgerValidationError";
    this.details = details;
  }
}

export class LedgerSupersessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerSupersessionError";
  }
}

////////////////////////////////////////////////////////////////
// Implementation guidance
////////////////////////////////////////////////////////////////
/*
Throw LedgerValidationError when Zod validation fails.
Throw LedgerSupersessionError when authority hierarchy prevents override.
*/

////////////////////////////////////////////////////////////////
// Scalability insight
////////////////////////////////////////////////////////////////
/*
Future ledger governance rules can introduce additional domain errors
without touching the service commit pipeline.
*/
