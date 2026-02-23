// apps/backend/src/lib/ws-auth.ts
// Purpose: Authenticate WebSocket using HttpOnly session cookie

import jwt from "jsonwebtoken";
import { parseCookies } from "./cookie";

export type WsAuthContext = {
  userId: string;
  tenantId: string;
  expiresAt: number; // add this
};

export function authenticateWsFromCookie(request: any): WsAuthContext | null {
  const cookies = parseCookies(request.headers?.cookie ?? "");
  const token = cookies.session;

  if (!token) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      tenantId: string;
      exp: number; // JWT expiration
    };

    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}
