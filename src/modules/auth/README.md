apps/backend/src/modules/auth/README.md

# Auth Module

## Purpose

This module implements tenant-scoped, passwordless authentication using:

- One-time login tokens (magic link flow, dev-mode enabled)
- Short-lived JWT access tokens
- Rotating refresh tokens
- Database-backed session revocation

It is designed for multi-tenant, governance-grade systems where identity must be:

- Tenant-isolated
- Revocable
- Auditable
- Server-validated

---

## Architecture Overview

Authentication is fully internal. No external auth provider is used.

Flow:

1. `POST /api/auth/request-login`
2. `POST /api/auth/verify`
3. `POST /api/auth/refresh`
4. `POST /api/auth/logout`

All other `/api/*` routes are protected by `authMiddleware`.

Auth routes are mounted **before** middleware in `app.ts`.

---

## Login Flow (Dev Mode)

### 1. Request Login

`POST /api/auth/request-login`

```json
{
  "email": "admin@ultra.local",
  "tenantSlug": "ultra-demo"
}

Server:

Validates tenant

Validates active user

Generates short-lived login token (10 minutes)

Stores hashed token in LoginToken

Returns { ok: true, devToken }

In production, devToken will be replaced with email delivery.

2. Verify Login

POST /api/auth/verify

{
  "token": "raw-token-from-request-login"
}

Server:

Hashes token

Validates token exists and not expired

Deletes login token (one-time use)

Creates Session record

Issues cookies:

session (JWT access token)

refresh (raw refresh token)

Returns:

{ "ok": true }
Session Model

Access token:

JWT

15 minutes

Stored in session cookie

Verified by authMiddleware

Refresh token:

Random UUID

Hashed before DB storage

Stored in refresh cookie

Rotated on /refresh

Valid for 7 days

Session row stored in:

Session {
  userId
  tenantId
  refreshTokenHash
  expiresAt
}

Deleting session row immediately revokes access.

Refresh Flow

POST /api/auth/refresh

Reads refresh cookie

Calls rotateSession()

Issues new session + refresh cookies

Rotates DB hash

Used for silent session renewal.

Logout Flow

POST /api/auth/logout

Hashes refresh token

Deletes matching session row

Clears cookies

After logout:

All protected routes return 401

Middleware Enforcement

authMiddleware:

Reads session cookie

Verifies JWT

Attaches:

req.user = {
  userId,
  tenantId,
  expiresAt
}

All /api/* routes require this.

Auth routes are excluded by mounting order.

Security Properties

✔ No password storage
✔ Hash-only storage for login tokens
✔ Hash-only storage for refresh tokens
✔ One-time login tokens
✔ Rotating refresh tokens
✔ Immediate revocation
✔ Tenant isolation enforced in JWT payload
✔ HttpOnly cookies
✔ SameSite protection

Required Environment Variables
JWT_SECRET=super-secure-random-string
CORS_ORIGIN=http://localhost:3000
Production Upgrade Checklist

Before production:

Replace devToken return with email delivery

Add rate limiting to request-login

Add background cleanup for expired LoginToken rows

Add IP throttling

Add session expiry pruning job

Enable secure cookies behind HTTPS

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

Access protected routes

Refresh

Logout

Revocation test

Module is operational.
```
