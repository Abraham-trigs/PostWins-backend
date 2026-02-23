// apps/backend/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { parseCookies } from "@/lib/cookie";

export function authMiddleware(
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
      exp: number;
    };

    (req as any).user = {
      userId: payload.userId,
      tenantId: payload.tenantId,
      expiresAt: payload.exp,
    };

    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
}
