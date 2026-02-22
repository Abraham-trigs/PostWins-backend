// apps/backend/src/modules/message/presence.ts
// Purpose: Case-scoped presence tracking (in-memory, upgradeable to Redis)

import type { WebSocket } from "ws";

type PresenceUser = {
  userId: string;
  tenantId: string;
};

type CasePresence = Map<string, PresenceUser>; // socketId → user

const casePresence = new Map<string, CasePresence>(); // caseId → sockets

export function addPresence(
  caseId: string,
  socketId: string,
  user: PresenceUser,
) {
  if (!casePresence.has(caseId)) {
    casePresence.set(caseId, new Map());
  }

  casePresence.get(caseId)!.set(socketId, user);
}

export function removePresence(caseId: string, socketId: string) {
  const caseMap = casePresence.get(caseId);
  if (!caseMap) return;

  caseMap.delete(socketId);

  if (caseMap.size === 0) {
    casePresence.delete(caseId);
  }
}

export function getCaseOnlineUsers(caseId: string) {
  const caseMap = casePresence.get(caseId);
  if (!caseMap) return [];

  // Deduplicate by userId
  const unique = new Map<string, PresenceUser>();

  for (const user of caseMap.values()) {
    unique.set(user.userId, user);
  }

  return Array.from(unique.values());
}
