// apps/backend/src/lib/cookie.ts
// Purpose: Safe cookie parser for WS + REST

export function parseCookies(cookieHeader?: string) {
  const cookies: Record<string, string> = {};

  if (!cookieHeader) return cookies;

  cookieHeader.split(";").forEach((cookie) => {
    const [key, ...rest] = cookie.trim().split("=");
    cookies[key] = decodeURIComponent(rest.join("="));
  });

  return cookies;
}
