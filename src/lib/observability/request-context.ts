import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";

type ContextStore = {
  requestId: string;
};

const storage = new AsyncLocalStorage<ContextStore>();

export function withRequestContext<T>(
  fn: () => Promise<T>,
  requestId?: string,
) {
  return storage.run(
    {
      requestId: requestId ?? randomUUID(),
    },
    fn,
  );
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
