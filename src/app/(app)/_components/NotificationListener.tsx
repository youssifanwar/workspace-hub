"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * Global listener that keeps an SSE connection open on every authenticated
 * page. Plays a chime and shows a toast when a new QR order arrives, so the
 * cashier notices even if they're on a different screen (like Bookings).
 */
export default function NotificationListener() {
  const router = useRouter();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [toast, setToast] = useState<NewOrderEvent | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "new_order") {
          beep();
          setToast(data);
          try {
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`New order · #${data.ticketNumber}`, {
                body: `${data.deskName} · ${data.itemCount} item(s)`,
              });
            }
          } catch {}
        }
      } catch {}
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function beep() {
    try {
      if (!audioCtxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const now = ctx.currentTime;
      [880, 1320, 880].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, now + i * 0.18);
        g.gain.linearRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
        g.gain.linearRampToValueAtTime(0, now + i * 0.18 + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(now + i * 0.18);
        o.stop(now + i * 0.18 + 0.16);
      });
    } catch {}
  }

  if (!toast) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 max-w-sm animate-slide-in"
      onClick={() => {
        router.push("/orders");
        setToast(null);
      }}
    >
      <div className="card p-4 border-l-4 border-l-emerald-500 cursor-pointer hover:-translate-y-0.5 transition">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white grid place-items-center text-xl shrink-0">
            🔔
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-900">
              New order · #{String(toast.ticketNumber).padStart(3, "0")}
            </div>
            <div className="text-sm text-slate-600">
              {toast.deskName} · {toast.itemCount} item{toast.itemCount > 1 ? "s" : ""}
            </div>
            <div className="text-xs text-indigo-600 font-semibold mt-1">
              Click to view →
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setToast(null);
            }}
            className="text-slate-400 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
