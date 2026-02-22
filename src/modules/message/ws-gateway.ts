// apps/backend/src/modules/message/ws-gateway.ts
// Purpose: Case-scoped WebSocket gateway with presence + ephemeral typing + Redis Pub/Sub scaling + server-side typing throttle.

import { WebSocket } from "ws";
import crypto from "crypto";
import { addPresence, removePresence, getCaseOnlineUsers } from "./presence";
import { redisPub, redisSub } from "../../lib/redis";

/* =========================================================
   Assumptions
   - socket.auth injected before registerSocket
   - presence.ts is in-memory only
   - Redis available for multi-instance broadcast
   - No DB writes
========================================================= */

const TYPING_THROTTLE_MS = 300;

type SocketWithMeta = WebSocket & {
  socketId: string;
  caseId: string;
  lastTypingAt?: number; // server-side throttle guard
  auth?: {
    userId: string;
    tenantId: string;
  };
};

type TypingUpdatePayload = {
  userId: string;
  isTyping: boolean;
};

type RedisEnvelope =
  | {
      kind: "PRESENCE";
      caseId: string;
      payload: unknown;
    }
  | {
      kind: "TYPING";
      caseId: string;
      payload: TypingUpdatePayload;
    };

const caseSockets = new Map<string, Set<SocketWithMeta>>();
const subscribedCases = new Set<string>();

/* =========================================================
   Register Socket
========================================================= */

export function registerSocket(caseId: string, ws: WebSocket) {
  const socket = ws as SocketWithMeta;

  socket.socketId = crypto.randomUUID();
  socket.caseId = caseId;
  socket.lastTypingAt = 0;

  if (!caseSockets.has(caseId)) {
    caseSockets.set(caseId, new Set());
  }

  caseSockets.get(caseId)!.add(socket);

  ensureRedisSubscription(caseId);

  //////////////////////////////////////////////////////////////
  // Presence Add
  //////////////////////////////////////////////////////////////

  if (socket.auth) {
    addPresence(caseId, socket.socketId, socket.auth);
  }

  publishPresence(caseId);

  //////////////////////////////////////////////////////////////
  // Typing Transport (Throttled)
  //////////////////////////////////////////////////////////////

  socket.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (!socket.auth?.userId) return;

      const now = Date.now();

      if (data.type === "TYPING_START") {
        // throttle START only
        if (now - (socket.lastTypingAt ?? 0) < TYPING_THROTTLE_MS) {
          return;
        }

        socket.lastTypingAt = now;
        publishTyping(caseId, socket.auth.userId, true);
      }

      if (data.type === "TYPING_STOP") {
        // STOP should not be throttled
        publishTyping(caseId, socket.auth.userId, false);
      }
    } catch {
      // ignore malformed
    }
  });

  //////////////////////////////////////////////////////////////
  // Disconnect
  //////////////////////////////////////////////////////////////

  socket.on("close", () => {
    caseSockets.get(caseId)?.delete(socket);

    if (socket.auth) {
      removePresence(caseId, socket.socketId);
    }

    if (socket.auth?.userId) {
      publishTyping(caseId, socket.auth.userId, false);
    }

    publishPresence(caseId);
  });
}

/* =========================================================
   Redis Subscription Per Case
========================================================= */

function ensureRedisSubscription(caseId: string) {
  if (subscribedCases.has(caseId)) return;

  const channel = redisChannel(caseId);

  redisSub.subscribe(channel);
  subscribedCases.add(caseId);

  redisSub.on("message", (_, message) => {
    try {
      const envelope = JSON.parse(message) as RedisEnvelope;
      if (envelope.caseId !== caseId) return;

      if (envelope.kind === "PRESENCE") {
        broadcastPresenceLocal(caseId, envelope.payload);
      }

      if (envelope.kind === "TYPING") {
        broadcastTypingLocal(caseId, envelope.payload);
      }
    } catch {
      // ignore
    }
  });
}

function redisChannel(caseId: string) {
  return `case:${caseId}`;
}

/* =========================================================
   Publish Presence (Redis)
========================================================= */

function publishPresence(caseId: string) {
  const onlineUsers = getCaseOnlineUsers(caseId);

  const envelope: RedisEnvelope = {
    kind: "PRESENCE",
    caseId,
    payload: onlineUsers,
  };

  redisPub.publish(redisChannel(caseId), JSON.stringify(envelope));
}

function broadcastPresenceLocal(caseId: string, payload: unknown) {
  const sockets = caseSockets.get(caseId);
  if (!sockets) return;

  const message = JSON.stringify({
    type: "PRESENCE_UPDATE",
    payload,
  });

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

/* =========================================================
   Publish Typing (Redis)
========================================================= */

function publishTyping(caseId: string, userId: string, isTyping: boolean) {
  const envelope: RedisEnvelope = {
    kind: "TYPING",
    caseId,
    payload: { userId, isTyping },
  };

  redisPub.publish(redisChannel(caseId), JSON.stringify(envelope));
}

function broadcastTypingLocal(caseId: string, payload: TypingUpdatePayload) {
  const sockets = caseSockets.get(caseId);
  if (!sockets) return;

  const message = JSON.stringify({
    type: "TYPING_UPDATE",
    payload,
  });

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

/* =========================================================
   Design reasoning
   - Server-side throttle prevents malicious typing floods.
   - START events are throttled; STOP always allowed.
   - No additional Redis load.
   - Zero DB writes.
========================================================= */

/* =========================================================
   Structure
   - registerSocket()
   - ensureRedisSubscription()
   - publishPresence / publishTyping
   - broadcast*Local()
========================================================= */

/* =========================================================
   Implementation guidance
   - Frontend should still debounce (defense-in-depth).
   - Throttle window adjustable via TYPING_THROTTLE_MS.
========================================================= */

/* =========================================================
   Scalability insight
   - Protects CPU and Redis under abuse.
   - Per-socket isolation.
   - O(1) throttle check.
========================================================= */
