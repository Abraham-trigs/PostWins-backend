// apps/backend/src/modules/message/ws-gateway.ts
// Purpose: Case-scoped WebSocket gateway with presence + typing + message broadcast +
// durable receipt propagation + cursor-based read tracking (multi-instance safe) +
// unread delta propagation and per-user unread reset.

import { WebSocket } from "ws";
import crypto from "crypto";
import { addPresence, removePresence, getCaseOnlineUsers } from "./presence";
import { redisPub, redisSub } from "../../lib/redis";
import { MessageReceiptService } from "./message-receipt.service";
import { ReadPositionService } from "./read-position.service";

const INSTANCE_ID = crypto.randomUUID();
const TYPING_THROTTLE_MS = 300;

const receiptService = new MessageReceiptService();
const readPositionService = new ReadPositionService();

type SocketWithMeta = WebSocket & {
  socketId: string;
  caseId: string;
  lastTypingAt?: number;
  auth?: {
    userId: string;
    tenantId: string;
  };
};

type TypingUpdatePayload = {
  userId: string;
  isTyping: boolean;
};

type ReceiptPayload = {
  messageId: string;
  userId: string;
  deliveredAt?: string;
  seenAt?: string;
};

type UnreadDeltaPayload = {
  userId: string;
  delta: number;
};

type RedisEnvelope =
  | { instanceId: string; kind: "PRESENCE"; caseId: string; payload: unknown }
  | {
      instanceId: string;
      kind: "TYPING";
      caseId: string;
      payload: TypingUpdatePayload;
    }
  | {
      instanceId: string;
      kind: "MESSAGE_CREATED";
      caseId: string;
      payload: any;
    }
  | {
      instanceId: string;
      kind: "MESSAGE_RECEIPT";
      caseId: string;
      payload: ReceiptPayload;
    }
  | {
      instanceId: string;
      kind: "UNREAD_DELTA";
      caseId: string;
      payload: UnreadDeltaPayload;
    };

const caseSockets = new Map<string, Set<SocketWithMeta>>();
const subscribedCases = new Set<string>();

////////////////////////////////////////////////////////////////
// Global Redis Listener
////////////////////////////////////////////////////////////////

redisSub.on("message", (_, raw) => {
  try {
    const envelope = JSON.parse(raw) as RedisEnvelope;

    if (envelope.instanceId === INSTANCE_ID) return;

    const sockets = caseSockets.get(envelope.caseId);
    if (!sockets || sockets.size === 0) return;

    let type: string | null = null;

    if (envelope.kind === "PRESENCE") type = "PRESENCE_UPDATE";
    if (envelope.kind === "TYPING") type = "TYPING_UPDATE";
    if (envelope.kind === "MESSAGE_CREATED") type = "MESSAGE_CREATED";
    if (envelope.kind === "MESSAGE_RECEIPT") type = "MESSAGE_RECEIPT";
    if (envelope.kind === "UNREAD_DELTA") type = "UNREAD_DELTA";

    if (!type) return;

    const message = JSON.stringify({ type, payload: envelope.payload });

    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  } catch {
    // ignore malformed
  }
});

////////////////////////////////////////////////////////////////
// Register Socket
////////////////////////////////////////////////////////////////

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

  if (socket.auth) {
    addPresence(caseId, socket.socketId, socket.auth);
  }

  publishPresence(caseId);

  socket.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (!socket.auth?.userId || !socket.auth?.tenantId) return;

      const now = Date.now();

      if (data.type === "TYPING_START") {
        if (now - (socket.lastTypingAt ?? 0) < TYPING_THROTTLE_MS) return;
        socket.lastTypingAt = now;
        publishTyping(caseId, socket.auth.userId, true);
      }

      if (data.type === "TYPING_STOP") {
        publishTyping(caseId, socket.auth.userId, false);
      }

      if (data.type === "MESSAGE_DELIVERED_BATCH") {
        if (!Array.isArray(data.messageIds)) return;

        for (const messageId of data.messageIds) {
          if (!messageId) continue;

          const receipt = await receiptService.markDelivered(
            socket.auth.tenantId,
            messageId,
            socket.auth.userId,
          );

          publishReceipt(caseId, {
            messageId: receipt.messageId,
            userId: receipt.userId,
            deliveredAt: receipt.deliveredAt?.toISOString(),
          });
        }
      }

      if (data.type === "MESSAGE_SEEN_BATCH") {
        if (!Array.isArray(data.messageIds)) return;

        for (const messageId of data.messageIds) {
          if (!messageId) continue;

          const receipt = await receiptService.markSeen(
            socket.auth.tenantId,
            messageId,
            socket.auth.userId,
          );

          publishReceipt(caseId, {
            messageId: receipt.messageId,
            userId: receipt.userId,
            seenAt: receipt.seenAt?.toISOString(),
          });
        }
      }

      if (data.type === "CASE_READ_UP_TO") {
        if (!data.messageId) return;

        await readPositionService.updatePosition(
          socket.auth.tenantId,
          caseId,
          socket.auth.userId,
          data.messageId,
        );

        // STEP 45 — per-user unread reset (no Redis broadcast)
        socket.send(
          JSON.stringify({
            type: "UNREAD_RESET",
            payload: { caseId },
          }),
        );
      }
    } catch {
      // ignore malformed
    }
  });

  socket.on("close", () => {
    const group = caseSockets.get(caseId);
    group?.delete(socket);

    if (socket.auth) {
      removePresence(caseId, socket.socketId);
      publishTyping(caseId, socket.auth.userId, false);
    }

    publishPresence(caseId);

    if (group && group.size === 0) {
      caseSockets.delete(caseId);
      redisSub.unsubscribe(redisChannel(caseId));
      subscribedCases.delete(caseId);
    }
  });
}

////////////////////////////////////////////////////////////////
// Redis Subscription
////////////////////////////////////////////////////////////////

function ensureRedisSubscription(caseId: string) {
  if (subscribedCases.has(caseId)) return;
  redisSub.subscribe(redisChannel(caseId));
  subscribedCases.add(caseId);
}

function redisChannel(caseId: string) {
  return `ws:case:${caseId}`;
}

////////////////////////////////////////////////////////////////
// Publishers
////////////////////////////////////////////////////////////////

export function publishMessage(caseId: string, message: any) {
  publish(caseId, "MESSAGE_CREATED", message);
  publishUnreadDelta(caseId, message.authorId); // STEP 44
}

export function publishReceipt(caseId: string, payload: ReceiptPayload) {
  publish(caseId, "MESSAGE_RECEIPT", payload);
}

export function publishAck(
  caseId: string,
  authorId: string,
  clientMutationId: string,
  messageId: string,
) {
  const sockets = caseSockets.get(caseId);
  if (!sockets) return;

  const ack = JSON.stringify({
    type: "MESSAGE_ACK",
    payload: { clientMutationId, messageId },
  });

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN && socket.auth?.userId === authorId) {
      socket.send(ack);
    }
  }
}

function publishPresence(caseId: string) {
  publish(caseId, "PRESENCE", getCaseOnlineUsers(caseId));
}

function publishTyping(caseId: string, userId: string, isTyping: boolean) {
  publish(caseId, "TYPING", { userId, isTyping });
}

////////////////////////////////////////////////////////////////
// STEP 44 — Local Unread Delta Publisher
////////////////////////////////////////////////////////////////

function publishUnreadDelta(caseId: string, authorId: string) {
  const sockets = caseSockets.get(caseId);
  if (!sockets) return;

  for (const socket of sockets) {
    if (
      socket.readyState === socket.OPEN &&
      socket.auth?.userId &&
      socket.auth.userId !== authorId
    ) {
      const message = JSON.stringify({
        type: "UNREAD_DELTA",
        payload: {
          caseId,
          delta: 1,
        },
      });

      socket.send(message);
    }
  }
}

////////////////////////////////////////////////////////////////
// Core Publish
////////////////////////////////////////////////////////////////

function publish(caseId: string, kind: RedisEnvelope["kind"], payload: any) {
  const envelope: RedisEnvelope = {
    instanceId: INSTANCE_ID,
    kind,
    caseId,
    payload,
  };

  redisPub.publish(redisChannel(caseId), JSON.stringify(envelope));

  const sockets = caseSockets.get(caseId);
  if (!sockets) return;

  const type =
    kind === "PRESENCE"
      ? "PRESENCE_UPDATE"
      : kind === "TYPING"
        ? "TYPING_UPDATE"
        : kind === "MESSAGE_CREATED"
          ? "MESSAGE_CREATED"
          : kind === "MESSAGE_RECEIPT"
            ? "MESSAGE_RECEIPT"
            : kind === "UNREAD_DELTA"
              ? "UNREAD_DELTA"
              : null;

  if (!type) return;

  const localMessage = JSON.stringify({ type, payload });

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(localMessage);
    }
  }
}
