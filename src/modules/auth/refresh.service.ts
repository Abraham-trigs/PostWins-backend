// apps/backend/src/modules/auth/refresh.service.ts
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const ACCESS_TTL = "15m";
const REFRESH_TTL_DAYS = 7;

export async function rotateSession(refreshToken: string) {
  const hashed = crypto.createHash("sha256").update(refreshToken).digest("hex");

  const session = await prisma.session.findFirst({
    where: { refreshTokenHash: hashed },
  });

  if (!session) throw new Error("INVALID_REFRESH");

  // Issue new tokens
  const newAccess = jwt.sign(
    { userId: session.userId, tenantId: session.tenantId },
    process.env.JWT_SECRET!,
    { expiresIn: ACCESS_TTL },
  );

  const newRefreshRaw = crypto.randomUUID();

  const newRefreshHash = crypto
    .createHash("sha256")
    .update(newRefreshRaw)
    .digest("hex");

  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: newRefreshHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400000),
    },
  });

  return { newAccess, newRefreshRaw };
}
