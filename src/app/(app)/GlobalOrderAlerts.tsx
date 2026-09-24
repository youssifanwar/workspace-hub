"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Ticket = {
  id: number;
  ticketNumber: number;
  status: "pending" | "printed" | "served" | "cancelled";
  deskName: string;
  items?: { quantity: number }[];
};

type TopAlert = {
  id: number;
  ticketNumber: number;
  desk: string;
  count: number;
};

export default function GlobalOrderAlerts() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<TopAlert[]>([]);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "default",
  );
  const [soundReady, setSoundReady] = useState(false);
  const [live, setLive] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const knownTicketIdsRef = useRef<Set<number>>(new Set());
  const initializedRef = useRef(false);
  const pollBusyRef = useRef(false);
  const notifiedIdsRef = useRef<Set<number>>(new Set());

  const unlockAudio = useCallback(async () => {
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass =
          window.AudioContext ||
          (
            window as unknown as {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (!AudioContextClass) return;
        audioCtxRef.current = new AudioContextClass();
      }

      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }

      setSoundReady(audioCtxRef.current.state === "running");
    } catch {
      setSoundReady(false);
    }
  }, []);

  const playBeep = useCallback(async () => {
    try {
      await unlockAudio();
      const context = audioCtxRef.current;
      if (!context || context.state !== "running") return;

      const now = context.currentTime;
      const notes = [
        [988, 0.0],
        [1319, 0.18],
        [988, 0.36],
        [1175, 0.72],
        [1568, 0.90],
        [1175, 1.08],
      ] as const;

      for (const [frequency, offset] of notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + offset;
        const end = start + 0.16;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.55, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.03);
      }
    } catch {
      // Browser audio can be blocked until a user gesture.
    }
  }, [unlockAudio]);

  const showTopAlert = useCallback((ticket: Ticket) => {
    const count = (ticket.items ?? []).reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );

    setAlerts((current) =>
      [
        ...current,
        {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          desk: ticket.deskName || "Desk",
          count: count || 1,
        },
      ].slice(-3),
    );

    window.setTimeout(() => {
      setAlerts((current) => current.filter((item) => item.id !== ticket.id));
    }, 7000);
  }, []);

  const notifySystem = useCallback((ticket: Ticket) => {
    try {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      const count = (ticket.items ?? []).reduce(
        (sum, item) => sum + Number(item.quantity || 0),
        0,
      );

      const notification = new Notification(
        `🔔 New order · Ticket #${String(ticket.ticketNumber).padStart(3, "0")}`,
        {
          body: `${ticket.deskName || "Desk"} · ${count || 1} item(s)`,
          tag: `wsh-order-${ticket.id}`,
          silent: false,
          requireInteraction: true,
        },
      );

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // In-app alert still works when browser notifications are unavailable.
    }
  }, []);

  const announceTicket = useCallback(
    async (ticket: Ticket) => {
      if (notifiedIdsRef.current.has(ticket.id)) return;
      notifiedIdsRef.current.add(ticket.id);

      await playBeep();
      showTopAlert(ticket);
      notifySystem(ticket);
    },
    [notifySystem, playBeep, showTopAlert],
  );

  const syncTickets = useCallback(async () => {
    if (pollBusyRef.current) return;
    pollBusyRef.current = true;

    try {
      const response = await fetch("/api/tickets", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });

      if (!response.ok) {
        setLive(false);
        return;
      }

      const data = await response.json();
      const tickets = Array.isArray(data.tickets)
        ? (data.tickets as Ticket[])
        : [];

      const newTickets = initializedRef.current
        ? tickets.filter(
            (ticket) =>
              !knownTicketIdsRef.current.has(ticket.id) &&
              ticket.status !== "served" &&
              ticket.status !== "cancelled",
          )
        : [];

      for (const ticket of tickets) {
        knownTicketIdsRef.current.add(ticket.id);
      }

      initializedRef.current = true;
      setLive(true);

      for (const ticket of newTickets) {
        await announceTicket(ticket);
      }
    } catch {
      setLive(false);
    } finally {
      pollBusyRef.current = false;
    }
  }, [announceTicket]);

  useEffect(() => {
    // Orders page already has its own live board/alert handling.
    // This global listener covers every other page without double alerts.
    if (pathname === "/orders") return;

    initializedRef.current = false;
    knownTicketIdsRef.current.clear();
    notifiedIdsRef.current.clear();

    void syncTickets();

    const pollTimer = window.setInterval(() => {
      void syncTickets();
    }, 2000);

    let source: EventSource | null = null;
    try {
      if ("EventSource" in window) {
        source = new EventSource("/api/events");
        source.onopen = () => setLive(true);
        source.onerror = () => setLive(false);
        source.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "new_order") {
              void syncTickets();
            }
          } catch {
            void syncTickets();
          }
        };
      }
    } catch {
      // Polling remains active as fallback.
    }

    return () => {
      window.clearInterval(pollTimer);
      try {
        source?.close();
      } catch {
        // ignore
      }
    };
  }, [pathname, syncTickets]);

  async function handleEnableAlerts() {
    await unlockAudio();
    await playBeep();

    if (!("Notification" in window)) return;

    try {
      let next = Notification.permission;
      if (next === "default") {
        next = await Notification.requestPermission();
      }
      setPermission(next);
    } catch {
      setPermission(Notification.permission);
    }
  }

  return (
    <>
      {/* Persistent control available from every app page. */}
      <button
        type="button"
        onClick={() => void handleEnableAlerts()}
        className="fixed bottom-5 right-5 z-[9999] rounded-xl border border-white/20 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-2xl transition hover:scale-[1.02]"
        title="Enable order sound and notifications"
      >
        {soundReady && permission === "granted"
          ? "🔔 Alerts on"
          : "🔔 Enable alerts"}
        <span className="ml-2 text-xs opacity-70">
          {live ? "• Live" : "• Offline"}
        </span>
      </button>

      {/* In-app top notifications work even when browser notifications are blocked. */}
      <div className="pointer-events-none fixed right-5 top-5 z-[10000] flex w-[min(390px,calc(100vw-32px))] flex-col gap-3">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="pointer-events-auto rounded-2xl border border-emerald-200 bg-white/95 px-4 py-4 shadow-2xl backdrop-blur"
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">🔔</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900">
                  New order received
                </div>
                <div className="mt-0.5 text-sm font-semibold text-slate-700">
                  Ticket #{String(alert.ticketNumber).padStart(3, "0")} · {alert.desk}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {alert.count} item(s) · Live Orders
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
