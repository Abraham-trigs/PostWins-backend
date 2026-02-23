Auth Module
Purpose

This module implements tenant-scoped, passwordless authentication using:

One-time login tokens (magic link flow, dev-mode enabled)

Short-lived JWT access tokens

Rotating refresh tokens

Database-backed session revocation

Concurrency-safe refresh handling (frontend mutex)

It is designed for multi-tenant, governance-grade systems where identity must be:

Tenant-isolated

Revocable

Auditable

Server-validated

Concurrency-safe

Architecture Overview

Authentication is fully internal. No external auth provider is used.

Flow:

POST /api/auth/request-login

POST /api/auth/verify

GET /api/auth/me

POST /api/auth/refresh

POST /api/auth/logout

All other /api/\* routes are protected by authMiddleware.

Auth routes are mounted before authMiddleware in app.ts.

Login Flow (Dev Mode)

1. Request Login

POST /api/auth/request-login

{
"email": "admin@ultra.local",
"tenantSlug": "ultra-demo"
}

Server:

Validates tenant

Validates active user

Generates short-lived login token (10 minutes)

Stores hashed token in LoginToken

Returns:

{ "ok": true, "devToken": "raw-token" }

In production, devToken must be replaced with email delivery.

2. Verify Login

POST /api/auth/verify

{
"token": "raw-token-from-request-login"
}

Server:

Hashes token

Validates token exists and is not expired

Deletes login token (one-time use)

Creates Session record

Issues cookies:

session → JWT access token

refresh → raw refresh token

Returns:

{ "ok": true }
Session Model
Access Token

JWT

15 minute TTL

Stored in session HttpOnly cookie

Verified by authMiddleware

Contains:

userId

tenantId

exp

Refresh Token

Random UUID

Hashed before DB storage

Stored in refresh HttpOnly cookie

Rotated on every /refresh

Valid for 7 days

Session Table
Session {
id
userId
tenantId
refreshTokenHash
expiresAt
revokedAt?
}

Deleting the session row immediately revokes access.

Identity Hydration
GET /api/auth/me

Returns current authenticated identity:

{
"ok": true,
"user": {
"userId": "...",
"tenantId": "...",
"roles": [...]
}
}

Used by:

Server layout guards

Client auth store hydration

RBAC enforcement layer

Refresh Flow
POST /api/auth/refresh

Server:

Reads refresh cookie

Hashes token

Looks up session

Rotates refresh token

Issues new access + refresh cookies

Updates DB hash

Returns:

{ "ok": true }
Concurrency Safety (Frontend Mutex)

The frontend transport layer implements a single-flight refresh mutex.

If multiple requests receive 401 simultaneously:

Only one refresh request is sent

Other requests wait for the same Promise

All retry safely after refresh

Prevents refresh storms

Prevents rotation race conditions

This guarantees refresh rotation integrity under load.

Logout Flow
POST /api/auth/logout

Server:

Hashes refresh token

Deletes matching session row

Clears cookies

After logout:

All protected routes return 401

Refresh no longer works

Session fully revoked

Middleware Enforcement
authMiddleware

Reads session cookie

Verifies JWT signature + expiry

Attaches:

req.user = {
userId,
tenantId,
expiresAt
}

All /api/\* routes require this.

Auth routes are excluded by mounting order.

Security Properties

✔ No password storage
✔ Hash-only storage for login tokens
✔ Hash-only storage for refresh tokens
✔ One-time login tokens
✔ Rotating refresh tokens
✔ Concurrency-safe refresh
✔ Immediate revocation
✔ Tenant isolation in JWT payload
✔ HttpOnly cookies
✔ SameSite protection
✔ Server-side route guarding

Required Environment Variables
JWT_SECRET=super-secure-random-string
CORS_ORIGIN=http://localhost:3000

Frontend:

NEXT_PUBLIC_BACKEND_ORIGIN=http://localhost:3001
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
Production Upgrade Checklist

Before production:

Replace devToken return with email delivery

Add rate limiting to request-login

Add IP throttling

Add background cleanup for expired LoginToken rows

Add session pruning job

Enable secure: true cookies behind HTTPS

Monitor refresh failure rates

Add device/session fingerprinting (optional hardening)

Folder Structure
auth/
auth.controller.ts
auth.routes.ts
refresh.service.ts
README.md
Status

Authentication lifecycle is fully implemented and verified via:

Login

Verify

Identity hydration

Access protected routes

Refresh rotation

Mutex concurrency protection

Logout

Revocation test

Module is stable and production-extendable.
