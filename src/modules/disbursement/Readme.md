Disbursement Module

Financial authorization and execution governance, ledger-bound and lifecycle-gated.

This module does not “send money.”

It protects causality.

If this module is weak, financial correctness collapses under concurrency, retries, or operator error.

Core Principle

Authorization is governance.
Execution is settlement.
Ledger is causality.

Never collapse these.

Domain Responsibilities

This module owns:

Disbursement authorization (lifecycle-gated)

Disbursement execution (state machine)

Ledger causality binding

Financial idempotency

Execution reconciliation

State explainability projection

It does not:

Transfer real funds (external adapter responsibility)

Decide lifecycle transitions

Bypass verification authority

Infer success outside transactional boundary

Financial State Model

DisbursementStatus (authoritative):

AUTHORIZED

EXECUTING

COMPLETED

FAILED

Each state transition is explicit.
Each mutation is ledger-bound.
Each ledger entry occurs in the same transaction as state change.

There are no silent transitions.

Authorization Phase

authorizeDisbursement()

Creates AUTHORIZED record only.

Does not execute.

Preconditions (Absolute)

Case must:

Exist

Be VERIFIED

Have execution record

Have execution.status === COMPLETED

Have exactly one authoritative verification record

If any fail → hard invariant violation.

No soft denial.
No partial authorization.

Idempotency Guard

One disbursement per case.

If one already exists:

If AUTHORIZED → return existing (safe retry)

If not AUTHORIZED → deny

This prevents:

Double financial commitment

Concurrent duplicate writes

Replay corruption

Ledger Causality

Appends:

DISBURSEMENT_AUTHORIZED

Payload includes:

disbursementId

amount

currency

payee

verificationRecordId

executionId

Authorization and ledger append are atomic.

If ledger fails, disbursement does not exist.

Execution Phase

executeDisbursement()

Strict state machine enforcement.

Preconditions

Disbursement must exist

Status must be AUTHORIZED

If not → invariant violation.

Transition Flow

AUTHORIZED
→ EXECUTING
→ COMPLETED | FAILED

EXECUTING is not cosmetic.

It exists to protect:

Crash recovery

Retry safety

Payment provider latency

Distributed execution engines

Ledger Causality

On success:

DISBURSEMENT_COMPLETED

On failure:

DISBURSEMENT_FAILED

Ledger append is in same transaction as status mutation.

No out-of-band logging.
No async causality.

Composite Flow

disburseCase()

Orchestrates:

authorizeDisbursement()

executeDisbursement()

Correct union handling prevents execution if authorization denied.

This separation exists even if currently called synchronously.

Why?

Because real-world payment providers are asynchronous.

You are future-proofing financial correctness.

Reconciliation

reconcileDisbursement()

System-triggered execution for stale AUTHORIZED records.

Only runs if:

status === AUTHORIZED

Executes under:

ActorKind.SYSTEM
authorityProof: "SYSTEM_RECONCILIATION"

This protects:

Stuck authorizations

Restart recovery

Settlement lag

It never overrides non-authorized states.

Explainability Projection

explainDisbursementState()

Pure function.

Outputs:

status

isTerminal

isInFlight

blockingReasons

No mutation.
No inference.
No business logic.

UI guidance only.

Authoritative truth remains in ledger + DB.

Invariants (Financial Constitution)

A case must be VERIFIED before authorization.

Execution must be COMPLETED before authorization.

Exactly one authoritative verification record required.

Authorization and execution must never collapse into one function.

Ledger event must occur in same transaction as state mutation.

AUTHORIZED is idempotent.

EXECUTING protects crash safety.

Ledger is canonical financial audit log.

Break these and money goes missing silently.

Concurrency Guarantees

Transaction boundary ensures:

Authorization cannot exist without ledger record.

Execution cannot mark COMPLETED without ledger record.

Double execution prevented by state precondition.

Replay safety under concurrent calls.

EXECUTING intermediate state prevents:

Duplicate settlement

Lost execution attempts

Race-condition double writes

Failure Modes Considered

Duplicate authorization attempt
→ Idempotent return

Concurrent execution
→ State precondition prevents re-entry

Execution crash mid-flight
→ Remains EXECUTING; reconciler can retry

Ledger failure
→ Transaction rollback

External provider timeout
→ Can remain AUTHORIZED or EXECUTING safely

Why Authorization and Execution Are Separate

Financial systems fail when they:

Authorize and execute in one step

Hide intermediate states

Conflate governance with settlement

Trust client lifecycle assumptions

Separation enables:

Async payment engines

Outbox-based settlement

Retry-safe external integrations

Multi-provider orchestration

Strong audit causality

You are designing for banks, not demos.

Scalability Characteristics

Current behavior:

One disbursement per case

O(1) writes per event

Fully transactional integrity

Future scaling options:

Outbox pattern for external provider calls

Event-driven settlement workers

Partitioned disbursement table

Settlement retry queues

Payment-provider-specific adapters

Architecture is settlement-engine ready.

Observability Expectations

Every state mutation must correspond to:

A ledger event

Authority proof

Actor kind

No silent mutation.
No implicit causality.

If auditors replay ledger, they must derive financial timeline deterministically.

Mental Model

Think of this module as a financial airlock.

Nothing leaves the case without:

Lifecycle verification

Explicit authorization

Immutable ledger causality

Controlled execution transition

Funds do not move because code says so.

Funds move because governance and immutable history agree.
