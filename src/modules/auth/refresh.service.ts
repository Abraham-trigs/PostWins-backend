// apps/backend/src/modules/auth/refresh.service.ts
// Purpose: Rotates refresh token and re-issues access JWT with sessionId for kill-switch enforcement.

import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * Assumptions:
 * - Session model includes: id, userId, tenantId, refreshTokenHash, expiresAt, revokedAt?
 * - revokedAt is nullable and used for kill-switch logic.
 */

const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 7;

/**
 * Design reasoning:
 * - Refresh token is hashed in DB (never store raw).
 * - Access JWT must carry sessionId for DB validation.
 * - Session rotation updates refresh hash and expiry.
 * - Kill-switch works because middleware checks sessionId existence + revokedAt.
 *
 * Structure:
 * - rotateSession(refreshToken)
 *
 * Implementation guidance:
 * - Called by auth.controller.refreshSession.
 * - Must throw on invalid, expired, or revoked sessions.
 *
 * Scalability insight:
 * - Can add device metadata and IP binding.
 * - Can log rotation attempts for anomaly detection.
 * - Can move expiry cleanup to cron job.
 */

export async function rotateSession(refreshToken: string) {
  // Hash incoming refresh token
  const hashed = crypto.createHash("sha256").update(refreshToken).digest("hex");

  const session = await prisma.session.findFirst({
    where: { refreshTokenHash: hashed },
  });

  if (!session) {
    throw new Error("INVALID_REFRESH");
  }

  // Kill-switch enforcement
  if (session.revokedAt) {
    throw new Error("SESSION_REVOKED");
  }

  if (session.expiresAt < new Date()) {
    throw new Error("SESSION_EXPIRED");
  }

  // Issue new access token (IMPORTANT: embed sessionId)
  const newAccess = jwt.sign(
    {
      userId: session.userId,
      tenantId: session.tenantId,
      sessionId: session.id,
    },
    process.env.JWT_SECRET!,
    { expiresIn: ACCESS_TTL },
  );

  // Generate new refresh token
  const newRefreshRaw = crypto.randomUUID();

  const newRefreshHash = crypto
    .createHash("sha256")
    .update(newRefreshRaw)
    .digest("hex");

  // Rotate refresh token atomically
  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: newRefreshHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400000),
    },
  });

  return { newAccess, newRefreshRaw };
}

/**
 * Example usage (from controller):
 *
 * const { newAccess, newRefreshRaw } = await rotateSession(refreshToken);
 */
