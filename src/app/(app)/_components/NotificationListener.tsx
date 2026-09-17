"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

type NewOrderEvent = {
  type: "new_order";
  ticketId: number;
  ticketNumber: number;
  deskName: string;
  customerName: string;
  itemCount: number;
  total: number;
  createdAt: string;
};

function isValidNewOrderEvent(
  value: unknown,
): value is NewOrderEvent {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const data = value as Record<string, unknown>;

  if (data.type !== "new_order") {
    return false;
  }

  if (
    typeof data.ticketId !== "number" ||
    !Number.isSafeInteger(data.ticketId) ||
    data.ticketId <= 0
  ) {
    return false;
  }

  if (
    typeof data.ticketNumber !== "number" ||
    !Number.isSafeInteger(data.ticketNumber) ||
    data.ticketNumber <= 0
  ) {
    return false;
  }

  if (
    typeof data.deskName !== "string" ||
    data.deskName.length > 200
  ) {
    return false;
  }

  if (
    typeof data.customerName !== "string" ||
    data.customerName.length > 200
  ) {
    return false;
  }

  if (
    typeof data.itemCount !== "number" ||
    !Number.isSafeInteger(data.itemCount) ||
    data.itemCount < 0
  ) {
    return false;
  }

  if (
    typeof data.total !== "number" ||
    !Number.isFinite(data.total) ||
    data.total < 0
  ) {
    return false;
  }

  if (
    typeof data.createdAt !== "string" ||
    data.createdAt.length > 100
  ) {
    return false;
  }

  return true;
}

export default function NotificationListener() {
  const router = useRouter();

  const audioCtxRef = useRef<AudioContext | null>(null);
  const [toast, setToast] =
    useState<NewOrderEvent | null>(null);

  const beep = useCallback(async () => {
    try {
      if (typeof window === "undefined") {
        return;
      }

      const AudioContextConstructor =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext?: typeof AudioContext;
          }
        ).webkitAudioContext;

      if (!AudioContextConstructor) {
        return;
      }

      if (!audioCtxRef.current) {
        audioCtxRef.current =
          new AudioContextConstructor();
      }

      const ctx = audioCtxRef.current;

      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          return;
        }
      }

      if (ctx.state !== "running") {
        return;
      }

      const now = ctx.currentTime;

      const notes = [880, 1320, 880];

      notes.forEach((frequency, index) => {
        const startAt = now + index * 0.18;
        const oscillator =
          ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(
          frequency,
          startAt,
        );

        gain.gain.setValueAtTime(
          0,
          startAt,
        );

        gain.gain.linearRampToValueAtTime(
          0.3,
          startAt + 0.02,
        );

        gain.gain.linearRampToValueAtTime(
          0,
          startAt + 0.15,
        );

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.start(startAt);
        oscillator.stop(startAt + 0.16);
      });
    } catch {
      // Audio is optional; notification flow must continue silently.
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const eventSource = new EventSource(
      "/api/events",
    );

    const handleMessage = (event: MessageEvent) => {
      if (!mounted) {
        return;
      }

      if (
        typeof event.data !== "string" ||
        event.data.length === 0 ||
        event.data.length > 100_000
      ) {
        return;
      }

      try {
        const parsed: unknown = JSON.parse(
          event.data,
        );

        if (!isValidNewOrderEvent(parsed)) {
          return;
        }

        const newOrder = {
          ...parsed,
          deskName: parsed.deskName.trim(),
          customerName:
            parsed.customerName.trim(),
          createdAt: parsed.createdAt.trim(),
        };

        if (
          !Number.isFinite(newOrder.total) ||
          newOrder.total < 0
        ) {
          return;
        }

        void beep();

        setToast(newOrder);

        if (
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification(
              `New order · #${String(
                newOrder.ticketNumber,
              ).padStart(3, "0")}`,
              {
                body: `${newOrder.deskName || "Workspace"} · ${
                  newOrder.itemCount
                } item${
                  newOrder.itemCount === 1
                    ? ""
                    : "s"
                }`,
                tag: `workspace-order-${newOrder.ticketId}`,
              },
            );
          } catch {
            // Browser notifications are optional.
          }
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    eventSource.onmessage = handleMessage;

    eventSource.onerror = () => {
      // EventSource handles reconnecting automatically.
    };

    return () => {
      mounted = false;
      eventSource.close();
    };
  }, [beep]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 6000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  useEffect(() => {
    return () => {
      const audioContext = audioCtxRef.current;

      audioCtxRef.current = null;

      if (audioContext) {
        void audioContext.close().catch(() => {
          // Ignore audio cleanup errors.
        });
      }
    };
  }, []);

  function openOrders() {
    setToast(null);
    router.push("/orders");
  }

  function closeToast(
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    setToast(null);
  }

  if (!toast) {
    return null;
  }

  const ticketNumber = String(
    toast.ticketNumber,
  ).padStart(3, "0");

  const itemLabel =
    toast.itemCount === 1 ? "item" : "items";

  return (
    <div
      className="fixed top-4 right-4 z-50 max-w-sm animate-slide-in"
      role="status"
      aria-live="polite"
    >
      <div
        className="card p-4 border-l-4 border-l-emerald-500 cursor-pointer hover:-translate-y-0.5 transition"
        onClick={openOrders}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            openOrders();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open order #${ticketNumber}`}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-2xl bg-emerald-500 text-white grid place-items-center text-xl shrink-0"
            aria-hidden="true"
          >
            🔔
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-900">
              New order · #{ticketNumber}
            </div>

            <div className="text-sm text-slate-600">
              {toast.deskName || "Workspace"} ·{" "}
              {toast.itemCount} {itemLabel}
            </div>

            {toast.customerName && (
              <div className="text-xs text-slate-500 mt-0.5 truncate">
                {toast.customerName}
              </div>
            )}

            <div className="text-xs text-indigo-600 font-semibold mt-1">
              Click to view →
            </div>
          </div>

          <button
            type="button"
            onClick={closeToast}
            className="text-slate-400 hover:text-slate-600 text-lg shrink-0"
            aria-label="Dismiss new order notification"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}