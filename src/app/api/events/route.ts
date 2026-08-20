import { getCurrentUser } from "@/lib/auth";
import { subscribe, publish } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-Sent Events endpoint. The cashier UI keeps this connection open and
 * receives real-time notifications for new QR orders (and any future events).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* client gone */
        }
      };

      // Say hello so the client knows the connection is live
      send({ type: "hello" });

      const unsubscribe = subscribe((event) => send(event));

      // Periodic keep-alive comment so proxies don't drop the connection
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 20_000);

      // Fire a synthetic self-ping so the pub/sub round-trip is exercised
      publish({ type: "ping" });

      const cleanup = () => {
        clearInterval(interval);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      // Store cleanup so cancel() can reach it
      (controller as unknown as { __cleanup?: () => void }).__cleanup = cleanup;
    },
    cancel() {
      // best-effort; individual controllers are cleaned up above
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
