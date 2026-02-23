// apps/backend/src/middleware/auth.middleware.ts
// Purpose: Verifies JWT AND validates active session in DB (Kill-Switch Enforcement)

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { parseCookies } from "@/lib/cookie";

/**
 * Assumptions:
 * - JWT now contains: userId, tenantId, sessionId, exp
 * - Session model includes: id, revokedAt?, expiresAt
 */

/**
 * Design reasoning:
 * - JWT verification alone is not sufficient.
 * - We validate the sessionId from JWT against the DB.
 * - If session missing, revoked, or expired → 401.
 * - Enables immediate session kill from DB.
 *
 * Structure:
 * - authMiddleware(req, res, next)
 *
 * Implementation guidance:
 * - Must run after cookieParser/parseCookies.
 * - Should be mounted after request logging middleware.
 *
 * Scalability insight:
 * - Can cache session lookups (Redis) for heavy traffic.
 * - Can extend to device fingerprint validation.
 */

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const cookies = parseCookies(req.headers.cookie ?? "");
  const token = cookies.session;

  if (!token) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      tenantId: string;
      sessionId: string;
      exp: number;
    };

    if (!payload.sessionId) {
      return res.status(401).json({
        ok: false,
        error: "Invalid session payload",
      });
    }

    // DB-backed session validation (Kill Switch)
    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session) {
      return res.status(401).json({
        ok: false,
        error: "Session invalid",
      });
    }

    if (session.revokedAt) {
      return res.status(401).json({
        ok: false,
        error: "Session revoked",
      });
    }

    if (session.expiresAt < new Date()) {
      return res.status(401).json({
        ok: false,
        error: "Session expired",
      });
    }

    // Attach trusted user identity to request
    (req as any).user = {
      userId: payload.userId,
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      expiresAt: payload.exp,
    };

    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}

/**
 * Example:
 * app.use("/api/protected", authMiddleware, protectedRoutes);
 */
