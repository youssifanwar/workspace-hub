// Simple in-process pub/sub for real-time notifications (SSE).
// Works out-of-the-box because the app runs as a single Node process (Electron
// or `next start`). If we ever scale horizontally we'd swap this for Redis/pg
// LISTEN/NOTIFY.

export type AppEvent =
  | {
      type: "new_order";
      ticketId: number;
      ticketNumber: number;
      bookingId: number;
      deskId: number;
      deskName: string;
      customerName: string;
      itemCount: number;
      total: number;
      createdAt: string;
    }
  | { type: "ping" };

type Listener = (event: AppEvent) => void;

declare global {
  // eslint-disable-next-line no-var
  var __wshEventListeners: Set<Listener> | undefined;
}

function getListeners(): Set<Listener> {
  if (!globalThis.__wshEventListeners) {
    globalThis.__wshEventListeners = new Set();
  }
  return globalThis.__wshEventListeners;
}

export function subscribe(fn: Listener): () => void {
  const set = getListeners();
  set.add(fn);
  return () => set.delete(fn);
}

export function publish(event: AppEvent): void {
  for (const fn of getListeners()) {
    try {
      fn(event);
    } catch {
      /* ignore */
    }
  }
}
