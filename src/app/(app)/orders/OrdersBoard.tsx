"use client";

import { useEffect, useRef, useState } from "react";

type Ticket = {
  id: number;
  ticketNumber: number;
  status: "pending" | "printed" | "served" | "cancelled";
  source: "staff" | "qr";
  customerNote: string | null;
  printedAt: string | null;
  servedAt: string | null;
  createdAt: string;
  bookingId: number;
  deskId: number;
  deskName: string;
  customerName: string;
  customerPhone: string;
  items: {
    id: number;
    name: string;
    quantity: number;
    unitPrice: string;
    note: string | null;
  }[];
  total: number;
};

declare global {
  interface Window {
    wsh?: {
      silentPrint?: (opts: {
        html: string;
        printerName?: string;
        copies?: number;
      }) => Promise<{ ok: boolean; error?: string }>;
      listPrinters?: () => Promise<string[]>;
    };
  }
}

export default function OrdersBoard({
  currency,
  autoPrint,
  kitchenPrinter,
}: {
  currency: string;
  autoPrint: boolean;
  kitchenPrinter: string;
}) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [soundOn, setSoundOn] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const printedIdsRef = useRef<Set<number>>(new Set());

  // Load initial tickets
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch("/api/tickets", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (cancelled) return;
      setTickets(data.tickets);
      // Consider already-printed tickets as printed so we don't reprint
      for (const t of data.tickets as Ticket[]) {
        if (t.printedAt) printedIdsRef.current.add(t.id);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // SSE connection
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setStatus("live");
    es.onerror = () => setStatus("offline");
    es.onmessage = async (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "new_order") {
          if (soundOn) playBeep();
          notify(data.deskName, data.ticketNumber, data.itemCount);
          // Refresh ticket list
          const res = await fetch("/api/tickets", { cache: "no-store" });
          if (res.ok) {
            const j = await res.json();
            setTickets(j.tickets);
          }
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-print pending tickets
  useEffect(() => {
    if (!autoPrint) return;
    (async () => {
      for (const t of tickets) {
        if (t.printedAt) continue;
        if (printedIdsRef.current.has(t.id)) continue;
        printedIdsRef.current.add(t.id);
        await printTicket(t, kitchenPrinter);
        await fetch(`/api/tickets/${t.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markPrinted: true }),
        });
      }
    })();
  }, [tickets, autoPrint, kitchenPrinter]);

  function playBeep() {
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
    } catch {
      /* ignore */
    }
  }

  function notify(desk: string, tn: number, count: number) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`New order · Ticket #${tn}`, {
          body: `${desk} · ${count} item(s)`,
          silent: false,
        });
      }
    } catch {}
  }

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  async function markServed(t: Ticket) {
    await fetch(`/api/tickets/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "served" }),
    });
    const res = await fetch("/api/tickets", { cache: "no-store" });
    if (res.ok) setTickets((await res.json()).tickets);
  }

  async function reprint(t: Ticket) {
    await printTicket(t, kitchenPrinter);
  }

  const pending = tickets.filter((t) => t.status !== "served" && t.status !== "cancelled");
  const done = tickets.filter((t) => t.status === "served" || t.status === "cancelled");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Live Orders</h1>
          <p className="text-slate-500">
            QR orders arrive here in real-time and print automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundOn((s) => !s)}
            className={`btn ${soundOn ? "btn-primary" : "btn-ghost"}`}
          >
            {soundOn ? "🔊 Sound on" : "🔇 Sound off"}
          </button>
          <div
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${
              status === "live"
                ? "bg-emerald-50 text-emerald-800"
                : status === "connecting"
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-800"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                status === "live"
                  ? "bg-emerald-500 animate-pulse"
                  : status === "connecting"
                  ? "bg-amber-500"
                  : "bg-red-500"
              }`}
            />
            {status === "live"
              ? "Live"
              : status === "connecting"
              ? "Connecting…"
              : "Offline"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Pending" value={pending.length} icon="⏳" color="from-amber-500 to-orange-500" />
        <StatBox label="Printed" value={pending.filter((t) => t.printedAt).length} icon="🧾" color="from-cyan-500 to-blue-500" />
        <StatBox label="Served today" value={done.length} icon="✅" color="from-emerald-500 to-teal-500" />
        <StatBox label="Auto-print" value={autoPrint ? "ON" : "OFF"} icon="🖨️" color={autoPrint ? "from-indigo-500 to-purple-500" : "from-slate-500 to-slate-600"} />
      </div>

      <div>
        <h2 className="text-lg font-bold mb-3">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="card p-10 text-center text-slate-400">
            <div className="text-4xl mb-2">🎉</div>
            All orders served!
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pending.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                currency={currency}
                onServed={() => markServed(t)}
                onReprint={() => reprint(t)}
              />
            ))}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div>
          <h2 className="text-lg font-bold mb-3">Recently served</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {done.slice(0, 6).map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                currency={currency}
                onServed={() => {}}
                onReprint={() => reprint(t)}
                muted
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: string;
  color: string;
}) {
  return (
    <div className={`kpi bg-gradient-to-br ${color}`}>
      <div className="text-xs uppercase text-white/80 font-semibold">{label}</div>
      <div className="flex items-end justify-between mt-2">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-3xl">{icon}</div>
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  currency,
  onServed,
  onReprint,
  muted,
}: {
  ticket: Ticket;
  currency: string;
  onServed: () => void;
  onReprint: () => void;
  muted?: boolean;
}) {
  return (
    <div
      className={`card p-4 ${muted ? "opacity-60" : ""} ${
        !ticket.printedAt ? "border-amber-300 ring-2 ring-amber-100" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold">
            Ticket #{String(ticket.ticketNumber).padStart(3, "0")}
          </div>
          <div className="font-bold text-lg">{ticket.deskName}</div>
          <div className="text-xs text-slate-500">
            👤 {ticket.customerName} · {new Date(ticket.createdAt).toLocaleTimeString()}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`badge ${
              ticket.source === "qr" ? "badge-blue" : "badge-slate"
            }`}
          >
            {ticket.source === "qr" ? "📱 QR" : "🧑‍💼 Staff"}
          </span>
          <span
            className={`badge ${
              ticket.status === "served"
                ? "badge-green"
                : ticket.status === "printed"
                ? "badge-blue"
                : "badge-amber"
            }`}
          >
            {ticket.status}
          </span>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-2 divide-soft">
        {ticket.items.map((i) => (
          <div key={i.id} className="py-1.5 flex items-start justify-between text-sm">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-indigo-600 tabular-nums">
                  {i.quantity}×
                </span>
                <span className="font-semibold truncate">{i.name}</span>
              </div>
              {i.note && (
                <div className="text-xs text-slate-500 italic pl-6">
                  ✎ {i.note}
                </div>
              )}
            </div>
            <div className="tabular-nums text-slate-600 text-sm">
              {(i.quantity * parseFloat(i.unitPrice)).toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      {ticket.customerNote && (
        <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs">
          <b>Customer note:</b> {ticket.customerNote}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="font-bold text-slate-800 tabular-nums">
          {ticket.total.toFixed(2)} {currency}
        </div>
        <div className="flex gap-1">
          <button className="btn btn-ghost !py-1.5 !px-3 text-xs" onClick={onReprint}>
            🖨 Reprint
          </button>
          {ticket.status !== "served" && (
            <button className="btn btn-success !py-1.5 !px-3 text-xs" onClick={onServed}>
              ✓ Served
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ticketHtml(t: Ticket): string {
  const rows = t.items
    .map(
      (i) => `
      <div class="row">
        <div class="qty">${i.quantity}×</div>
        <div class="name">${escapeHtml(i.name)}${
          i.note ? `<div class="note">${escapeHtml(i.note)}</div>` : ""
        }</div>
      </div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket #${
    t.ticketNumber
  }</title>
<style>
@page { size: 80mm auto; margin: 0; }
body { font-family: 'Courier New', monospace; font-size: 13px; margin: 0; padding: 6mm 4mm; color: #000; }
h1 { font-size: 28px; text-align: center; margin: 0 0 4px; letter-spacing: 1px; }
.h { text-align:center; font-weight:bold; font-size:16px; margin-bottom:2px; }
.sub { text-align:center; font-size:11px; margin-bottom:8px; }
.rule { border-top: 1px dashed #000; margin: 6px 0; }
.row { display:flex; gap:6px; padding: 3px 0; align-items: flex-start; }
.qty { font-weight:bold; min-width:26px; font-size:14px; }
.name { flex:1; font-size:14px; }
.note { font-style: italic; font-size: 11px; margin-top: 2px; }
.footer { text-align:center; margin-top:8px; font-size:11px; }
.tn { text-align:center; font-size:32px; font-weight:bold; letter-spacing:2px; margin:4px 0; }
</style></head><body>
<div class="h">KITCHEN ORDER</div>
<div class="tn">#${String(t.ticketNumber).padStart(3, "0")}</div>
<div class="sub">${escapeHtml(t.deskName)} · ${escapeHtml(t.customerName)}</div>
<div class="sub">${new Date(t.createdAt).toLocaleString()}</div>
<div class="rule"></div>
${rows}
<div class="rule"></div>
${
  t.customerNote
    ? `<div style="font-style:italic;font-size:12px;padding:4px 0;">Note: ${escapeHtml(
        t.customerNote,
      )}</div><div class="rule"></div>`
    : ""
}
<div class="footer">Total items: ${t.items.reduce(
    (s, i) => s + i.quantity,
    0,
  )} · Source: ${t.source.toUpperCase()}</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function printTicket(t: Ticket, printerName: string) {
  const html = ticketHtml(t);
  // Prefer Electron silent print if available
  if (typeof window !== "undefined" && window.wsh?.silentPrint) {
    try {
      await window.wsh.silentPrint({
        html,
        printerName: printerName || undefined,
        copies: 1,
      });
      return;
    } catch {
      // fall through to browser print
    }
  }
  // Browser fallback: open in a hidden iframe and print
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {}
      setTimeout(() => iframe.remove(), 2000);
    }, 200);
  }
}
