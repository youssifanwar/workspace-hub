import { getCurrentUser } from "@/lib/auth";
import { subscribe } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Server-Sent Events endpoint.
 *
 * The cashier UI keeps this connection open and receives real-time
 * notifications for new QR orders and other server events.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const closeConnection = () => {
        if (closed) return;

        closed = true;

        clearInterval(heartbeatInterval);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      const send = (data: unknown) => {
        if (closed) return;

        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          closeConnection();
        }
      };

      const sendHeartbeat = () => {
        if (closed) return;

        try {
          controller.enqueue(
            encoder.encode(": ping\n\n"),
          );
        } catch {
          closeConnection();
        }
      };

      // Initial event so the client knows the connection is alive.
      send({
        type: "hello",
      });

      const unsubscribe = subscribe((event) => {
        send(event);
      });

      const heartbeatInterval = setInterval(
        sendHeartbeat,
        HEARTBEAT_INTERVAL_MS,
      );

      cleanup = closeConnection;

      // Abort when the browser/client disconnects.
      req.signal.addEventListener(
        "abort",
        closeConnection,
        { once: true },
      );
    },

    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}