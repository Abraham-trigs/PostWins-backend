// apps/backend/src/lib/ws-auth.ts
// Purpose: Authenticate WebSocket using HttpOnly session cookie

import jwt from "jsonwebtoken";
import { parseCookies } from "./cookie";

export type WsAuthContext = {
  userId: string;
  tenantId: string;
};

export function authenticateWsFromCookie(request: any): WsAuthContext | null {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.session;

  if (!token) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      tenantId: string;
    };

    return {
      userId: payload.userId,
      tenantId: payload.tenantId,
      expiresAt: decoded.exp,
    };
  } catch {
    return null;
  }
}
