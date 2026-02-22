export type MessageCursor = {
  createdAt: string; // ISO string
  id: string;
};

export function encodeCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(raw: string): MessageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));

    if (!parsed?.createdAt || !parsed?.id) {
      throw new Error();
    }

    return parsed;
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}
