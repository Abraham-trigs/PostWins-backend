Auth Module

Governance-bound identity creation, magic-link authentication, session rotation, and kill-switch enforcement for multi-tenant Posta.

This module is not “just login.”

It is the gatekeeper of tenant isolation, session integrity, and governance-controlled identity provisioning.

If this module fails, the entire trust boundary fails.

What This Module Owns

Invite-based identity creation (single authorized entry point)

Dev-mode magic login flow

Login token verification

Session issuance with DB-backed kill-switch

Refresh token rotation

Logout with session revocation

Governance-triggered verifier provisioning

Identity introspection (current user)

It does not:

Define authorization policy (RBAC rules live elsewhere)

Enforce domain-level permissions

Evaluate case logic

Handle OAuth/social providers (yet)

Core Philosophy

Authentication is cheap.
Identity governance is not.

This module separates:

Identity provisioning (invite + governance)

Session lifecycle management

Access token validation via DB-backed session

The result: revocable, tenant-scoped, auditable identity.

Identity Creation (Invite-Only)

File: accept-invite.controller.ts

This is the only code path allowed to create users.

That constraint is intentional.

Invariants

Invite token must exist

Token must be unexpired

Token is hashed in DB (raw token never stored)

Role must exist within tenant

User creation is atomic

Invite is deleted after use

Session issued only after identity finalized

Transactional Guarantees

The flow runs inside a single Prisma transaction:

Validate role still exists

Check if user already exists (race condition defense)

Create user if needed

Ensure role attached (idempotent)

Delete invite (single-use)

Create session

Issue access + refresh tokens

No partial identity can exist.

If any step fails → nothing persists.

That is governance-grade provisioning.

Magic Login (Dev Mode)

File: auth.controller.ts

This flow is intentionally simple but secure:

Step 1 — Request Login

Validates tenant slug

Validates user existence + active status

Creates one-time login token

Stores hashed token

Expires in 10 minutes

Raw token is returned in dev mode.

In production, this becomes:

Email delivery

Secure link flow

Potential device binding

Step 2 — Verify Login

Hashes provided token

Ensures token exists

Ensures token not expired

Deletes token (one-time usage)

Creates DB session

Issues JWT with sessionId embedded

Embedding sessionId is the critical design decision.

Session Model: DB-Backed Kill Switch

Access tokens are not standalone truth.

Each access JWT includes:

userId

tenantId

sessionId

Your auth middleware must:

Verify JWT signature

Look up session by sessionId

Ensure session exists

Ensure not revoked

Ensure not expired

That is the kill switch.

Delete or revoke the session → access token instantly invalid.

Stateless JWT systems cannot do this.

This module intentionally chooses revocability over purity.

Refresh Token Rotation

File: refresh.service.ts

Design guarantees:

Refresh token is hashed in DB

Raw refresh never stored

Each refresh rotates token hash

Session expiry extended atomically

Access JWT reissued with same sessionId

Rotation prevents replay attacks.

If a refresh token leaks:

It becomes invalid immediately after use.

Kill-switch logic also checks:

revokedAt

expiresAt

This is session lifecycle discipline, not just token issuance.

Logout (Kill Switch Activation)

Logout:

Hashes refresh token

Sets revokedAt timestamp

Clears cookies

Revocation is non-destructive.

Why?

Because forensic audits require session history.

Deletion destroys evidence.
Revocation preserves it.

Governance-Triggered Provisioning

File: provision-verifier.controller.ts

Identity creation is not always direct.

Sometimes it must be:

Proposed

Reviewed

Approved

This endpoint submits a governance proposal via ApprovalGateService.

Policy key:
PROVISION_VERIFIER

Effect payload:

email

roleKey

Auth module does not execute provisioning here.
It triggers a governance workflow.

That separation prevents privilege escalation via direct API access.

Tenant Isolation

Every identity is scoped by:

tenantId (database)

tenantSlug (login initiation)

session tenantId (JWT claim)

There is no cross-tenant identity resolution.

If a user exists in Tenant A, that identity is meaningless in Tenant B.

Multi-tenant correctness is structural, not conditional.

Security Posture

Token hashing:

Invite tokens hashed

Login tokens hashed

Refresh tokens hashed

Access token:

Signed with JWT_SECRET

Short TTL (15m)

Refresh token:

Long TTL (7 days)

Rotated on each use

Stored hashed

Cookies:

httpOnly

sameSite=lax

secure enabled in production

path="/"

Session validation:

DB-backed

Revocation supported

Expiry enforced

Failure Modes Considered

Invite reused → impossible (deleted in transaction)

Race condition double user creation → prevented via transactional check

Stolen refresh token → rotated on use

Stale access token → invalid if session revoked

Expired login token → deleted immediately

Tenant mismatch → prevented at login initiation

Scalability Characteristics

Horizontal scaling safe because:

Sessions live in DB

JWT verification is stateless except for session lookup

Refresh rotation is O(1)

Login tokens short-lived

Future extensions:

Device fingerprinting

IP binding

Suspicious rotation logging

Rate limiting on request-login

Multi-factor authentication

WebAuthn

Audit pipeline integration

Invariants (Non-Negotiable)

Users are created only through invite or governed flow.

Tokens are never stored raw.

Sessions are revocable.

Refresh tokens are rotated.

Tenant boundaries are absolute.

Break these and you degrade from “enterprise system” to “side project.”

Mental Model

Think of this module as a controlled airlock.

People do not just “enter the system.”

They:

Receive authorization to approach.

Pass identity validation.

Receive a time-bound access badge.

Have that badge tied to a central registry.

Can have it revoked instantly.

That is identity done with institutional seriousness.
