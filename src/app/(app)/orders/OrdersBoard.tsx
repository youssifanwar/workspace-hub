"use client";

import { useEffect, useRef, useState } from "react";
import { useFmt } from "@/lib/lang-context";

type OrderAlert = {
  id: number;
  desk: string;
  ticketNumber: number;
  count: number;
};

type Ticket = {
  id: number;
  ticketNumber: number;
  status:
    | "pending"
    | "printed"
    | "served"
    | "cancelled";
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
      }) => Promise<{
        ok: boolean;
        error?: string;
      }>;

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
  const f = useFmt();
  const tx = f.t;
  const [tickets, setTickets] =
    useState<Ticket[]>([]);

  const [status, setStatus] =
    useState<
      "connecting" | "live" | "offline"
    >("connecting");

  const [soundOn, setSoundOn] =
    useState(true);

  const [alerts, setAlerts] =
    useState<OrderAlert[]>([]);

  const [busyTicketId, setBusyTicketId] =
    useState<number | null>(null);

  const [actionError, setActionError] =
    useState<string | null>(null);

  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(
      typeof window !== "undefined" && "Notification" in window
        ? Notification.permission
        : "default",
    );

  const audioCtxRef =
    useRef<AudioContext | null>(null);

  const printedIdsRef =
    useRef<Set<number>>(new Set());

  const knownTicketIdsRef =
    useRef<Set<number>>(new Set());

  const soundOnRef =
    useRef(true);

  const pollingInFlightRef =
    useRef(false);

  const initializedRef =
    useRef(false);

  /* ---------------------------------------------------------------------- */
  /* LIVE TICKET SYNC                                                       */
  /* ---------------------------------------------------------------------- */

  async function syncTickets() {
    if (pollingInFlightRef.current) {
      return;
    }

    pollingInFlightRef.current = true;

    try {
      const res = await fetch(
        "/api/tickets",
        {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
        },
      );

      if (!res.ok) {
        setStatus("offline");
        return;
      }

      const data = await res.json();
      const nextTickets =
        Array.isArray(data.tickets)
          ? (data.tickets as Ticket[])
          : [];

      const newlyArrived =
        initializedRef.current
          ? nextTickets.filter(
              (ticket) =>
                !knownTicketIdsRef.current.has(
                  ticket.id,
                ) &&
                ticket.status !== "served" &&
                ticket.status !== "cancelled",
            )
          : [];

      setTickets(nextTickets);
      setStatus("live");

      for (const ticket of nextTickets) {
        if (ticket.printedAt) {
          printedIdsRef.current.add(ticket.id);
        }

        knownTicketIdsRef.current.add(ticket.id);
      }

      if (newlyArrived.length > 0) {
        for (const ticket of newlyArrived) {
          if (soundOnRef.current) {
            void playBeep();
          }

          notify(
            ticket.id,
            ticket.deskName,
            ticket.ticketNumber,
            ticket.items.reduce(
              (sum, item) => sum + item.quantity,
              0,
            ),
          );
        }
      }

      initializedRef.current = true;
    } catch {
      setStatus("offline");
    } finally {
      pollingInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void syncTickets();

    const timer = window.setInterval(() => {
      void syncTickets();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* FAST LIVE EVENT FALLBACK                                               */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let source: EventSource | null = null;

    try {
      if ("EventSource" in window) {
        source = new EventSource("/api/events");

        source.onmessage = () => {
          void syncTickets();
        };
      }
    } catch {
      /* polling still keeps the board live */
    }

    return () => {
      try {
        source?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* AUTO PRINT                                                             */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!autoPrint) {
      return;
    }

    (async () => {
      for (const ticket of tickets) {
        if (
          ticket.printedAt ||
          ticket.status === "cancelled" ||
          ticket.status === "served"
        ) {
          continue;
        }

        if (
          printedIdsRef.current.has(
            ticket.id,
          )
        ) {
          continue;
        }

        printedIdsRef.current.add(
          ticket.id,
        );

        await printTicket(
          ticket,
          kitchenPrinter,
        );

        try {
          await fetch(
            `/api/tickets/${ticket.id}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                markPrinted:
                  true,
              }),
            },
          );
        } catch {
          /* ignore */
        }
      }
    })();
  }, [
    tickets,
    autoPrint,
    kitchenPrinter,
  ]);

  /* ---------------------------------------------------------------------- */
  /* SOUND                                                                  */
  /* ---------------------------------------------------------------------- */

  async function unlockAudio() {
    try {
      if (
        !audioCtxRef.current
      ) {
        const AudioContextClass =
          window.AudioContext ||
          (
            window as unknown as {
              webkitAudioContext: typeof AudioContext;
            }
          ).webkitAudioContext;

        if (!AudioContextClass) {
          return;
        }

        audioCtxRef.current =
          new AudioContextClass();
      }

      if (
        audioCtxRef.current.state ===
        "suspended"
      ) {
        await audioCtxRef.current.resume();
      }
    } catch {
      /* ignore */
    }
  }

  async function enableAlerts() {
    await unlockAudio();
    await playBeep();

    if (
      "Notification" in window
    ) {
      try {
        let permission = Notification.permission;

        if (permission === "default") {
          permission = await Notification.requestPermission();
        }

        setNotificationPermission(permission);
      } catch {
        setNotificationPermission(Notification.permission);
      }
    }
  }

  async function handleAlertsClick() {
    if (!soundOnRef.current) {
      soundOnRef.current = true;
      setSoundOn(true);
    }

    await enableAlerts();
  }

  async function playBeep() {
    try {
      await unlockAudio();

      const context =
        audioCtxRef.current;

      if (!context || context.state !== "running") {
        return;
      }

      const now = context.currentTime;
      const notes = [
        { frequency: 880, offset: 0 },
        { frequency: 1320, offset: 0.18 },
        { frequency: 880, offset: 0.36 },
        { frequency: 1175, offset: 0.82 },
        { frequency: 1568, offset: 1.0 },
        { frequency: 1175, offset: 1.18 },
      ];

      for (const note of notes) {
        const oscillator =
          context.createOscillator();
        const gain =
          context.createGain();

        const start =
          now + note.offset;
        const end =
          start + 0.14;

        oscillator.type = "sine";
        oscillator.frequency.value =
          note.frequency;

        gain.gain.setValueAtTime(
          0,
          start,
        );
        gain.gain.linearRampToValueAtTime(
          0.55,
          start + 0.02,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          end,
        );

        oscillator
          .connect(gain)
          .connect(context.destination);

        oscillator.start(start);
        oscillator.stop(end + 0.02);
      }
    } catch {
      /* ignore */
    }
  }

  /* ---------------------------------------------------------------------- */
  /* NOTIFICATION                                                           */
  /* ---------------------------------------------------------------------- */

  function showTopAlert(
    ticketId: number,
    desk: string,
    ticketNumber: number,
    count: number,
  ) {
    setAlerts((current) => [
      ...current,
      {
        id: ticketId,
        desk,
        ticketNumber,
        count,
      },
    ].slice(-3));

    window.setTimeout(() => {
      setAlerts((current) =>
        current.filter((item) => item.id !== ticketId),
      );
    }, 6000);
  }

  function notify(
    ticketId: number,
    desk: string,
    ticketNumber: number,
    count: number,
  ) {
    showTopAlert(
      ticketId,
      desk,
      ticketNumber,
      count,
    );

    try {
      if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const notification = new Notification(
          `🔔 New order · Ticket #${String(
            ticketNumber,
          ).padStart(3, "0")}`,
          {
            body: `${desk} · ${count} item(s)`,
            tag: `wsh-order-${ticketId}`,
            silent: false,
            requireInteraction: true,
          },
        );

        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  /* ---------------------------------------------------------------------- */
  /* SERVE & CANCEL                                                         */
  /* ---------------------------------------------------------------------- */

  async function reloadTicketsNow() {
    const res = await fetch("/api/tickets", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
    }
  }

  async function markServed(
    ticket: Ticket,
  ) {
    if (busyTicketId !== null) return;
    setBusyTicketId(ticket.id);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/tickets/${ticket.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            status: "served",
          }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActionError(err?.error || "Could not mark order as served.");
        return;
      }

      await reloadTicketsNow();
    } catch {
      setActionError("Network error while updating order.");
    } finally {
      setBusyTicketId(null);
    }
  }

  async function cancelTicket(
    ticket: Ticket,
  ) {
    if (busyTicketId !== null) return;
    const confirmed = window.confirm(
      f.en ? `Cancel ticket #${String(ticket.ticketNumber).padStart(3, "0")} (${ticket.deskName}) and remove its items from the customer's bill?` : `إلغاء تذكرة #${String(ticket.ticketNumber).padStart(3, "0")} (${ticket.deskName}) وشيل أصنافها من فاتورة العميل؟`,
    );
    if (!confirmed) return;

    setBusyTicketId(ticket.id);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/tickets/${ticket.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            status: "cancelled",
          }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActionError(err?.error || "Could not cancel order.");
        return;
      }

      await reloadTicketsNow();
    } catch {
      setActionError("Network error while cancelling order.");
    } finally {
      setBusyTicketId(null);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* REPRINT                                                                */
  /* ---------------------------------------------------------------------- */

  async function reprint(
    ticket: Ticket,
  ) {
    await printTicket(
      ticket,
      kitchenPrinter,
    );
  }

  /* ---------------------------------------------------------------------- */
  /* START PREPARING (pending -> printed, uses the existing status flow)     */
  /* ---------------------------------------------------------------------- */

  async function startPreparing(ticket: Ticket) {
    if (busyTicketId !== null) return;
    setBusyTicketId(ticket.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "printed" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setActionError(err?.error || tx("مقدرناش نبدأ التحضير."));
        return;
      }
      await reloadTicketsNow();
    } catch {
      setActionError(tx("مشكلة في الاتصال أثناء تحديث الطلب."));
    } finally {
      setBusyTicketId(null);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* COLUMNS                                                                */
  /* ---------------------------------------------------------------------- */

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, []);

  const fresh = tickets.filter((t) => t.status === "pending");
  const preparing = tickets.filter((t) => t.status === "printed");
  const finished = tickets.filter((t) => t.status === "served" || t.status === "cancelled").slice(0, 6);
  const newest = fresh[0];
  const servedCount = tickets.filter((t) => t.status === "served").length;

  /* ---------------------------------------------------------------------- */
  /* MAIN UI                                                                */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="x-page">
      {/* TOP ORDER ALERTS */}
      <div className="fixed top-4 left-4 z-[9999] w-[min(380px,calc(100vw-2rem))] space-y-3 pointer-events-none">
        {alerts.map((alert) => (
          <div key={alert.id} className="pointer-events-auto x-card" style={{ borderColor: "#a7f3d0" }}>
            <div className="font-bold" style={{ color: "#047857" }}>{tx("🔔 وصل طلب جديد")}</div>
            <div className="x-row-title mt-1">{tx("تذكرة")} #{String(alert.ticketNumber).padStart(3, "0")} · {alert.desk}</div>
            <div className="x-row-sub">{alert.count} {tx("أصناف")}</div>
          </div>
        ))}
      </div>

      <div className="x-head">
        <div>
          <h1>{tx("طلبات المشروبات")}</h1>
          <p>{tx("الطلبات بتتحدث لحظياً من الـ QR والكاشير")}</p>
        </div>
        <div className="x-actions">
          <span className={`x-chip ${status === "live" ? "green" : status === "connecting" ? "amber" : ""}`} style={status === "offline" ? { background: "#fee2e2", color: "#991b1b" } : undefined}>
            <span className="x-dot" style={status === "live" ? undefined : { background: status === "offline" ? "#dc2626" : "#f59e0b", boxShadow: "none" }} />
            {status === "live" ? tx("مباشر") : status === "connecting" ? tx("بيتصل…") : tx("مفيش اتصال")}
          </span>
          <span className="x-chip">{autoPrint ? tx("الطباعة التلقائية شغالة") : tx("الطباعة التلقائية مقفولة")}</span>
          <button onClick={() => { void handleAlertsClick(); }} className="x-btn dark" title={notificationPermission === "denied" ? tx("إشعارات المتصفح متقفلة لهذا الموقع. فعّلها من إعدادات الموقع.") : tx("اضغط مرة عشان يشتغل الصوت والإشعارات.")}>
            {notificationPermission === "granted" ? tx("🔊 التنبيهات شغالة") : tx("🔔 فعّل التنبيهات")}
          </button>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="x-note" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b", marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
          <span>{actionError}</span>
          <button type="button" className="underline" onClick={() => setActionError(null)}>{tx("إغلاق")}</button>
        </div>
      )}

      {newest && (
        <div className="x-banner" role="status">
          <div>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{tx("طلب جديد! تذكرة")} #{String(newest.ticketNumber).padStart(3, "0")} {tx("من")} {newest.deskName}</div>
            <div style={{ opacity: 0.9, fontSize: 13, marginTop: 4 }}>{newest.items.reduce((n, i) => n + i.quantity, 0)} {tx("أصناف")} · {newest.source === "qr" ? tx("من الـ QR") : tx("من الكاشير")}</div>
          </div>
          <button type="button" className="x-btn" disabled={busyTicketId !== null} onClick={() => void startPreparing(newest)}>{tx("ابدأ التحضير")}</button>
        </div>
      )}

      <div className="x-board">
        <Column title={tx("طلبات جديدة")} count={fresh.length} tone="amber">
          {fresh.length === 0 ? <div className="x-card x-empty">{tx("مفيش طلبات جديدة 🎉")}</div> : fresh.map((t) => (
            <TicketCard key={t.id} ticket={t} allTickets={tickets} now={tick} currency={currency} busy={busyTicketId === t.id}
              primary={{ label: tx("ابدأ التحضير"), tone: "primary", onClick: () => void startPreparing(t) }}
              onCancel={() => cancelTicket(t)} onReprint={() => reprint(t)} />
          ))}
        </Column>
        <Column title={tx("بيتحضّر")} count={preparing.length} tone="blue">
          {preparing.length === 0 ? <div className="x-card x-empty">{tx("مفيش حاجة بتتحضّر.")}</div> : preparing.map((t) => (
            <TicketCard key={t.id} ticket={t} allTickets={tickets} now={tick} currency={currency} busy={busyTicketId === t.id}
              primary={{ label: tx("✓ تم التقديم"), tone: "success", onClick: () => markServed(t) }}
              onCancel={() => cancelTicket(t)} onReprint={() => reprint(t)} />
          ))}
        </Column>
        <Column title={tx("اتقدّمت النهارده")} count={servedCount} tone="green">
          {finished.length === 0 ? <div className="x-card x-empty">{tx("لسه مفيش طلبات اتقدّمت.")}</div> : finished.map((t) => (
            <TicketCard key={t.id} ticket={t} allTickets={tickets} now={tick} currency={currency} done />
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({ title, count, tone, children }: { title: string; count: number; tone: "amber" | "blue" | "green"; children: React.ReactNode }) {
  const f = useFmt();
  const tx = f.t;
  return (
    <section>
      <div className="x-col-head">
        <span>{title}</span>
        <span className={`x-count tone-${tone}`}>{count}</span>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* TICKET DISPLAY NUMBER                                                    */
/* ------------------------------------------------------------------------ */

function getDisplayTicketNumber(ticket: Ticket, allTickets: Ticket[]): number {
  const sameNumberCount = allTickets.filter((item) => item.ticketNumber === ticket.ticketNumber).length;
  if (sameNumberCount <= 1) return ticket.ticketNumber;
  return ticket.id;
}

function elapsedLabel(createdAt: string, now: number): { text: string; tone: "green" | "amber" | "red" } {
  const secs = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return { text: `${m}:${String(s).padStart(2, "0")}`, tone: m < 3 ? "green" : m < 8 ? "amber" : "red" };
}

/* ------------------------------------------------------------------------ */
/* TICKET CARD                                                              */
/* ------------------------------------------------------------------------ */

function TicketCard({
  ticket,
  currency,
  allTickets,
  now,
  busy,
  primary,
  onCancel,
  onReprint,
  done,
}: {
  ticket: Ticket;
  currency: string;
  allTickets: Ticket[];
  now: number;
  busy?: boolean;
  primary?: { label: string; tone: "primary" | "success"; onClick: () => void };
  onCancel?: () => void;
  onReprint?: () => void;
  done?: boolean;
}) {
  const f = useFmt();
  const tx = f.t;
  const displayNumber = getDisplayTicketNumber(ticket, allTickets);
  const isCancelled = ticket.status === "cancelled";
  const isNew = ticket.status === "pending";
  const el = elapsedLabel(ticket.createdAt, now);
  const time = new Date(ticket.createdAt).toLocaleTimeString(f.en ? "en-GB" : "ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit" });

  return (
    <div className={`x-ticket ${isNew ? "new" : ""} ${done ? "done" : ""}`}>
      <div className="x-ticket-top">
        <span className="x-ticket-no x-num">#{String(displayNumber).padStart(3, "0")}</span>
        <span className="x-pill">{ticket.deskName}</span>
        <span className={`x-pill ${ticket.source === "qr" ? "violet" : "teal"}`}>{ticket.source === "qr" ? "QR" : tx("كاشير")}</span>
        <span className="flex-1" />
        {done ? (
          <span className={`x-pill ${isCancelled ? "red" : "green"} x-num`}>{isCancelled ? tx("اتلغى") : time}</span>
        ) : (
          <span className={`x-pill ${el.tone} x-num`} dir="ltr">⏱ {el.text}</span>
        )}
      </div>

      <div>
        {isCancelled && ticket.items.length === 0 ? (
          <div className="x-row-sub" style={{ color: "#dc2626" }}>{tx("اتلغى · الأصناف اتشالت من فاتورة العميل")}</div>
        ) : (
          ticket.items.map((item) => (
            <div key={item.id}>
              <div className="x-item">
                <span className="x-qty x-num">×{item.quantity}</span>
                <span className="flex-1 min-w-0 truncate">{item.name}</span>
              </div>
              {item.note && <div className="x-row-sub" style={{ paddingInlineStart: 44 }}>✎ {item.note}</div>}
            </div>
          ))
        )}
      </div>

      {ticket.customerNote && <div className="x-note">📝 {ticket.customerNote}</div>}

      {done ? (
        <div className="x-row-sub" style={{ marginTop: 10 }}>{ticket.customerName} · <span className="x-num">{ticket.total.toFixed(2)} {currency}</span></div>
      ) : (
        <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
          {primary && (
            <button type="button" className={`x-btn ${primary.tone} flex-1`} disabled={busy} onClick={primary.onClick}>{busy ? "…" : primary.label}</button>
          )}
          {onCancel && <button type="button" className="x-btn danger" disabled={busy} onClick={onCancel}>{tx("إلغاء")}</button>}
          {onReprint && <button type="button" className="x-btn" disabled={busy} onClick={onReprint} title={tx("طباعة")}>🖨</button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* PRINT HTML                                                               */
/* ------------------------------------------------------------------------ */

function ticketHtml(
  ticket: Ticket,
  allTickets?: Ticket[],
): string {
  const displayNumber =
    getDisplayTicketNumber(
      ticket,
      allTickets ??
        [ticket],
    );

  const rows = ticket.items
    .map(
      (item) => `
      <div class="row">
        <div class="qty">${item.quantity}×</div>
        <div class="name">
          ${escapeHtml(
            item.name,
          )}
          ${
            item.note
              ? `<div class="note">${escapeHtml(
                  item.note,
                )}</div>`
              : ""
          }
        </div>
      </div>
    `,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Ticket #${displayNumber}</title>

<style>
@page {
  size: 80mm auto;
  margin: 0;
}

body {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  margin: 0;
  padding: 6mm 4mm;
  color: #000;
}

h1 {
  font-size: 28px;
  text-align: center;
  margin: 0 0 4px;
  letter-spacing: 1px;
}

.h {
  text-align: center;
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 2px;
}

.sub {
  text-align: center;
  font-size: 11px;
  margin-bottom: 8px;
}

.rule {
  border-top: 1px dashed #000;
  margin: 6px 0;
}

.row {
  display: flex;
  gap: 6px;
  padding: 3px 0;
  align-items: flex-start;
}

.qty {
  font-weight: bold;
  min-width: 26px;
  font-size: 14px;
}

.name {
  flex: 1;
  font-size: 14px;
}

.note {
  font-style: italic;
  font-size: 11px;
  margin-top: 2px;
}

.footer {
  text-align: center;
  margin-top: 8px;
  font-size: 11px;
}

.tn {
  text-align: center;
  font-size: 32px;
  font-weight: bold;
  letter-spacing: 2px;
  margin: 4px 0;
}
</style>
</head>

<body>

<div class="h">
  KITCHEN ORDER
</div>

<div class="tn">
  #${String(
    displayNumber,
  ).padStart(3, "0")}
</div>

<div class="sub">
  ${escapeHtml(
    ticket.deskName,
  )}
  ·
  ${escapeHtml(
    ticket.customerName,
  )}
</div>

<div class="sub">
  ${new Date(
    ticket.createdAt,
  ).toLocaleString()}
</div>

<div class="rule"></div>

${rows}

<div class="rule"></div>

${
  ticket.customerNote
    ? `
<div style="font-style:italic;font-size:12px;padding:4px 0;">
  Note: ${escapeHtml(
    ticket.customerNote,
  )}
</div>
<div class="rule"></div>
`
    : ""
}

<div class="footer">
  Total items:
  ${ticket.items.reduce(
    (sum, item) =>
      sum + item.quantity,
    0,
  )}
  · Source:
  ${ticket.source.toUpperCase()}
</div>

</body>
</html>`;
}

/* ------------------------------------------------------------------------ */
/* ESCAPE HTML                                                              */
/* ------------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    "&": "\u0026amp;",
    "<": "\u0026lt;",
    ">": "\u0026gt;",
    '"': "\u0026quot;",
  };
  return value.replace(/[&<>"]/g, (ch) => map[ch] || ch);
}

/* ------------------------------------------------------------------------ */
/* PRINT                                                                    */
/* ------------------------------------------------------------------------ */

async function printTicket(
  ticket: Ticket,
  printerName: string,
) {
  const html =
    ticketHtml(ticket);

  if (
    typeof window !==
      "undefined" &&
    window.wsh?.silentPrint
  ) {
    try {
      await window.wsh.silentPrint(
        {
          html,
          printerName:
            printerName ||
            undefined,
          copies: 1,
        },
      );

      return;
    } catch {
      /* fall through */
    }
  }

  const iframe =
    document.createElement(
      "iframe",
    );

  iframe.style.position =
    "fixed";

  iframe.style.right =
    "0";

  iframe.style.bottom =
    "0";

  iframe.style.width =
    "0";

  iframe.style.height =
    "0";

  iframe.style.border =
    "0";

  document.body.appendChild(
    iframe,
  );

  const doc =
    iframe.contentWindow
      ?.document;

  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* ignore */
    }

    setTimeout(() => {
      iframe.remove();
    }, 2000);
  }, 200);
}