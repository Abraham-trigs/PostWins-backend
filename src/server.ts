// apps/backend/src/server.ts
// Purpose: Application bootstrap + governance scheduler + secure WebSocket support + heartbeat protection + CSWSH mitigation + per-IP WS rate limiting.

import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import app from "./app";

import { prisma } from "./lib/prisma";
import { registerSocket } from "./modules/message/ws-gateway";
import { authenticateWsFromCookie } from "./lib/ws-auth";
import { SYSTEM_CONSTANTS } from "./constants/system.constants";

////////////////////////////////////////////////////////////////
// Environment
////////////////////////////////////////////////////////////////

const PORT = Number(process.env.PORT) || 3001;
const MODE = process.env.MODE || "production";

const ENABLE_SCHEDULER = process.env.ENABLE_LIFECYCLE_SCHEDULER === "true";
const ENABLE_SCHEDULER_LOCK = process.env.ENABLE_LIFECYCLE_LOCK !== "false";

const ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

////////////////////////////////////////////////////////////////
// WS RATE LIMIT (Per IP)
////////////////////////////////////////////////////////////////

const WS_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const WS_RATE_LIMIT_MAX = 30; // 30 upgrade attempts per minute

const ipConnectionMap = new Map<string, number[]>();

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = ipConnectionMap.get(ip) || [];

  const recent = timestamps.filter((ts) => now - ts < WS_RATE_LIMIT_WINDOW_MS);

  recent.push(now);
  ipConnectionMap.set(ip, recent);

  return recent.length > WS_RATE_LIMIT_MAX;
}

////////////////////////////////////////////////////////////////
// HTTP SERVER
////////////////////////////////////////////////////////////////

const server = http.createServer(app);

////////////////////////////////////////////////////////////////
// WEBSOCKET SERVER (Heartbeat Enabled)
////////////////////////////////////////////////////////////////

type WSWithHeartbeat = WebSocket & {
  isAlive?: boolean;
};

const wss = new WebSocketServer({ noServer: true });

const HEARTBEAT_INTERVAL = 30000;

function heartbeat(this: WSWithHeartbeat) {
  this.isAlive = true;
}

wss.on("connection", (ws: WSWithHeartbeat) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  ws.on("error", (err) => {
    console.error("WebSocket connection error:", err);
  });
});

wss.on("error", (err) => {
  console.error("WebSocketServer error:", err);
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const socket = ws as WSWithHeartbeat;

    if (socket.isAlive === false) {
      return socket.terminate();
    }

    socket.isAlive = false;
    socket.ping();
  });
}, HEARTBEAT_INTERVAL);

////////////////////////////////////////////////////////////////
// UPGRADE HANDLER
////////////////////////////////////////////////////////////////

server.on("upgrade", async (request, socket, head) => {
  try {
    ////////////////////////////////////////////////////////////
    // Rate Limiting (FIRST)
    ////////////////////////////////////////////////////////////

    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      socket.destroy();
      return;
    }

    ////////////////////////////////////////////////////////////
    // CSWSH Protection
    ////////////////////////////////////////////////////////////

    const origin = request.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      socket.destroy();
      return;
    }

    ////////////////////////////////////////////////////////////
    // URL Validation
    ////////////////////////////////////////////////////////////

    const url = request.url;
    if (!url || !url.startsWith("/ws/cases/")) {
      socket.destroy();
      return;
    }

    const parts = url.split("/ws/cases/");
    if (parts.length < 2 || !parts[1]) {
      socket.destroy();
      return;
    }

    const caseId = parts[1];

    ////////////////////////////////////////////////////////////
    // Authentication
    ////////////////////////////////////////////////////////////

    const auth = authenticateWsFromCookie(request);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    ////////////////////////////////////////////////////////////
    // Tenant Isolation
    ////////////////////////////////////////////////////////////

    const caseExists = await prisma.case.findFirst({
      where: {
        id: caseId,
        tenantId: auth.tenantId,
      },
      select: { id: true },
    });

    if (!caseExists) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    ////////////////////////////////////////////////////////////
    // Upgrade
    ////////////////////////////////////////////////////////////

    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as any).auth = auth;
      (ws as any).expiresAt = auth.expiresAt;
      registerSocket(caseId, ws);
    });
  } catch {
    socket.destroy();
  }
});

////////////////////////////////////////////////////////////////
// Scheduler Lock
////////////////////////////////////////////////////////////////

async function acquireSchedulerLock(): Promise<boolean> {
  if (!ENABLE_SCHEDULER_LOCK) return true;

  try {
    const [{ pg_try_advisory_lock }] = await prisma.$queryRaw<
      { pg_try_advisory_lock: boolean }[]
    >`SELECT pg_try_advisory_lock(${SYSTEM_CONSTANTS.SCHEDULER_ADVISORY_LOCK_ID})`;

    return pg_try_advisory_lock;
  } catch {
    return false;
  }
}

////////////////////////////////////////////////////////////////
// SERVER START
////////////////////////////////////////////////////////////////

server.listen(PORT, async () => {
  console.log(
    `Posta Backend running on http://localhost:${PORT} in ${MODE} mode`,
  );

  if (!ENABLE_SCHEDULER || MODE === "MOCK") return;

  const lockAcquired = await acquireSchedulerLock();

  if (!lockAcquired) {
    console.warn(
      "Lifecycle Scheduler lock not acquired. Another instance is leader.",
    );
    return;
  }

  console.log("Lifecycle Reconciliation Scheduler enabled");
});

////////////////////////////////////////////////////////////////
// GRACEFUL SHUTDOWN
////////////////////////////////////////////////////////////////

async function shutdown() {
  clearInterval(interval);

  try {
    if (ENABLE_SCHEDULER_LOCK) {
      await prisma.$queryRaw`
        SELECT pg_advisory_unlock(${SYSTEM_CONSTANTS.SCHEDULER_ADVISORY_LOCK_ID})
      `;
    }
  } catch {}

  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
