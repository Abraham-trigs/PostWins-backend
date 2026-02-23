// apps/backend/src/modules/auth/auth.controller.ts
// Purpose: Handles magic login request + verification + session issuance (dev-mode magic link)
// Updated: Access JWT now carries sessionId for DB-backed kill-switch validation.

import { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { rotateSession } from "./refresh.service";

/**
 * Assumptions:
 * - Session model includes: id, userId, tenantId, refreshTokenHash, expiresAt, revokedAt?
 * - authMiddleware will validate sessionId against DB.
 * - JWT_SECRET is defined.
 */

const LOGIN_TOKEN_TTL_MINUTES = 10;
const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 7;

/* ============================================================
   STEP 3 — Request Login
============================================================ */

export async function requestLogin(req: Request, res: Response) {
  try {
    const { email, tenantSlug } = req.body as {
      email?: string;
      tenantSlug?: string;
    };

    if (!email || !tenantSlug) {
      return res.status(400).json({
        ok: false,
        error: "Email and tenantSlug are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedSlug = tenantSlug.trim().toLowerCase();

    const tenant = await prisma.tenant.findUnique({
      where: { slug: normalizedSlug },
    });

    if (!tenant) {
      return res.status(404).json({ ok: false, error: "Tenant not found" });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        tenantId: tenant.id,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "User not found or inactive",
      });
    }

    const rawToken = crypto.randomUUID();

    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const expiresAt = new Date(
      Date.now() + LOGIN_TOKEN_TTL_MINUTES * 60 * 1000,
    );

    await prisma.loginToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return res.status(200).json({
      ok: true,
      devToken: rawToken,
      expiresInMinutes: LOGIN_TOKEN_TTL_MINUTES,
    });
  } catch {
    return res.status(500).json({
      ok: false,
      error: "Failed to initiate login",
    });
  }
}

/* ============================================================
   STEP 5 — Verify Login + Issue Session (Kill-Switch Enabled)
============================================================ */

export async function verifyLogin(req: Request, res: Response) {
  try {
    const { token } = req.body as { token?: string };

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Token is required",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const loginToken = await prisma.loginToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!loginToken) {
      return res.status(401).json({
        ok: false,
        error: "Invalid or expired token",
      });
    }

    if (loginToken.expiresAt < new Date()) {
      await prisma.loginToken.delete({ where: { id: loginToken.id } });

      return res.status(401).json({
        ok: false,
        error: "Token expired",
      });
    }

    const user = loginToken.user;

    // One-time token usage
    await prisma.loginToken.delete({ where: { id: loginToken.id } });

    // Generate refresh token
    const refreshRaw = crypto.randomUUID();

    const refreshHash = crypto
      .createHash("sha256")
      .update(refreshRaw)
      .digest("hex");

    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

    // IMPORTANT: capture session record
    const sessionRecord = await prisma.session.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        refreshTokenHash: refreshHash,
        expiresAt: refreshExpiresAt,
      },
    });

    // 🔐 Embed sessionId inside JWT (Gold Standard Kill Switch)
    const accessToken = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenantId,
        sessionId: sessionRecord.id,
      },
      process.env.JWT_SECRET!,
      { expiresIn: ACCESS_TTL },
    );

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("session", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    });

    res.cookie("refresh", refreshRaw, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({
      ok: false,
      error: "Verification failed",
    });
  }
}

/* ============================================================
   REFRESH SESSION
============================================================ */

export async function refreshSession(req: Request, res: Response) {
  try {
    const refreshToken = req.cookies?.refresh;

    if (!refreshToken) {
      return res.status(401).json({
        ok: false,
        error: "Missing refresh token",
      });
    }

    // rotateSession must now return sessionId
    const { newAccess, newRefreshRaw } = await rotateSession(refreshToken);

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("session", newAccess, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    });

    res.cookie("refresh", newRefreshRaw, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
    });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(401).json({
      ok: false,
      error: "Invalid refresh token",
    });
  }
}

/* ============================================================
   LOGOUT (Kill Switch)
============================================================ */

export async function logout(req: Request, res: Response) {
  try {
    const refreshToken = req.cookies?.refresh;

    if (refreshToken) {
      const refreshHash = crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex");

      // Non-destructive option: update revokedAt instead of delete
      await prisma.session.updateMany({
        where: { refreshTokenHash: refreshHash },
        data: { revokedAt: new Date() },
      });
    }

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("session", "", {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });

    res.cookie("refresh", "", {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({
      ok: false,
      error: "Logout failed",
    });
  }
}

/* ============================================================
   AUTH GUARD SUPPORT
============================================================ */

export function getSession(req: Request, res: Response) {
  const user = (req as any).user;

  return res.status(200).json({
    ok: true,
    user,
  });
}

/* ============================================================
   GET CURRENT USER IDENTITY
============================================================ */

export async function getCurrentUser(req: Request, res: Response) {
  const auth = (req as any).user;

  if (!auth) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: {
      roles: {
        include: { role: true },
      },
      tenant: true,
    },
  });

  if (!user || !user.isActive) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  return res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      roles: user.roles.map((r) => r.role.key),
    },
  });
}
